import { timeoutSignal } from './signals';
import { CameraIndex, cameraFromNode, type Camera } from './cameras';
import { metersPerDegree, type Bounds, type LonLat } from './geo';
import type { RouteLine } from './routeLine';
import { memoryCache, type TileCache } from './tileCache';

/**
 * Camera locations come from OpenStreetMap. Inside the United States they are read from
 * the static tiles Raven publishes on GitHub Pages (rebuilt from Geofabrik's extract);
 * elsewhere the public Overpass API is queried for the area around the route.
 */
export const RAVEN_API = 'https://uhuhuhuhuhuhuhuh.github.io/Raven/api/v1/';
export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

type Ring = { hole: boolean; points: Array<[number, number]> };
export type TileIndex = { version: 1; dataTimestamp: string | null; tileSize: number; count: number; tiles: string[]; coverage: Ring[] };
type CachedTile = { stamp: string | null; fetchedAt: number; cameras: Camera[] };
type TileRecord = [number, number, number, Record<string, string>];

const OVERPASS_MAX_AGE_MS = 3 * 24 * 3600_000;
const TILE_CONCURRENCY = 4;
const MAX_OVERPASS_CELLS = 12;

export function parseTileIndex(value: unknown): TileIndex | null {
  const index = value as Partial<TileIndex> | null;
  if (!index || index.version !== 1 || !(Number(index.tileSize) > 0)) return null;
  if (!Array.isArray(index.tiles) || !Array.isArray(index.coverage) || index.coverage.length === 0) return null;
  return index as TileIndex;
}

function inRing(lon: number, lat: number, points: Array<[number, number]>): boolean {
  let inside = false;
  let [previousLon, previousLat] = points[points.length - 1];
  for (const [currentLon, currentLat] of points) {
    if ((currentLat > lat) !== (previousLat > lat)) {
      const crossing = previousLon + ((lat - previousLat) * (currentLon - previousLon)) / (currentLat - previousLat);
      if (lon < crossing) inside = !inside;
    }
    previousLon = currentLon;
    previousLat = currentLat;
  }
  return inside;
}

export function coverageContains(coverage: Ring[], lon: number, lat: number): boolean {
  return [lon, lon + 360, lon - 360].some(candidate =>
    coverage.reduce((depth, ring) => depth + (inRing(candidate, lat, ring.points) ? (ring.hole ? -1 : 1) : 0), 0) > 0
  );
}

export function tileKey(lon: number, lat: number, tileSize: number): string {
  return `${Math.floor(lat / tileSize)}_${Math.floor(lon / tileSize)}`;
}

/** Tile keys within `margin` meters of any point of the line (sampled every ~500 m). */
export function tileKeysAlong(line: RouteLine, tileSize: number, margin: number): Set<string> {
  const keys = new Set<string>();
  const add = ([lon, lat]: LonLat) => {
    const scale = metersPerDegree(lat);
    const dLon = margin / scale.lon;
    const dLat = margin / scale.lat;
    for (const x of [lon - dLon, lon + dLon]) for (const y of [lat - dLat, lat + dLat]) keys.add(tileKey(x, y, tileSize));
  };
  const { coordinates, cumulative } = line;
  for (let index = 0; index < coordinates.length; index += 1) {
    add(coordinates[index]);
    if (index > 0) {
      const span = cumulative[index] - cumulative[index - 1];
      for (let step = 500; step < span; step += 500) {
        const t = step / span;
        const [a, b] = [coordinates[index - 1], coordinates[index]];
        add([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return keys;
}

function tileBounds(key: string, tileSize: number): Bounds {
  const [row, column] = key.split('_').map(Number);
  return { south: row * tileSize, north: (row + 1) * tileSize, west: column * tileSize, east: (column + 1) * tileSize };
}

function tileCenter(key: string, tileSize: number): LonLat {
  const bounds = tileBounds(key, tileSize);
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

export function overpassQuery(bounds: Bounds): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:25];(
node["man_made"="surveillance"]["surveillance:type"~"^(ALPR|ANPR|LPR)$",i](${box});
node["man_made"="surveillance"]["manufacturer"~"flock",i](${box});
node["man_made"="surveillance"]["manufacturer:wikidata"="Q108485435"](${box});
node["man_made"="surveillance"]["brand"~"flock",i](${box});
node["man_made"="surveillance"]["operator"~"flock",i](${box});
node["highway"="speed_camera"](${box});
);out;`;
}

export type CoverageReport = { complete: boolean; failedAreas: number };

export class CameraRepository {
  readonly index = new CameraIndex();
  private readonly loaded = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private tileIndexRequest: Promise<TileIndex | null> | null = null;
  dataTimestamp: string | null = null;
  /** Bumped whenever cameras are added, so views can refresh. */
  revision = 0;

  constructor(
    private readonly options: {
      apiBase?: string;
      fetchImpl?: typeof fetch;
      cache?: TileCache;
      overpassEndpoints?: string[];
      onChange?: () => void;
    } = {}
  ) {}

  private get fetcher(): typeof fetch {
    return this.options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  private get cache(): TileCache {
    return (this.options.cache ??= memoryCache());
  }

  private get apiBase(): string {
    return this.options.apiBase ?? RAVEN_API;
  }

  /** Raven's tile index; the last cached copy is used when offline. Null if never available. */
  tileIndex(): Promise<TileIndex | null> {
    this.tileIndexRequest ??= (async () => {
      try {
        const response = await this.fetcher(new URL('osm/index.json', this.apiBase), { headers: { Accept: 'application/json' }, signal: timeoutSignal(15_000) });
        const index = response.ok ? parseTileIndex(await response.json()) : null;
        if (index) {
          await this.cache.set('index', index);
          this.dataTimestamp = index.dataTimestamp;
          return index;
        }
      } catch {
        // offline or unreachable: fall back to the cached index below
      }
      const cached = parseTileIndex(await this.cache.get('index'));
      this.dataTimestamp = cached?.dataTimestamp ?? null;
      if (!cached) this.tileIndexRequest = null; // retry on the next request
      return cached;
    })();
    return this.tileIndexRequest;
  }

  private addCameras(cameras: Camera[]) {
    if (!cameras.length) return;
    this.index.add(cameras);
    this.revision += 1;
    this.options.onChange?.();
  }

  private loadOnce(key: string, loader: () => Promise<boolean>): Promise<boolean> {
    if (this.loaded.has(key)) return Promise.resolve(true);
    let request = this.pending.get(key);
    if (!request) {
      request = loader()
        .then(ok => {
          if (ok) this.loaded.add(key);
          return ok;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    return request;
  }

  private loadRavenTile(index: TileIndex, key: string, signal?: AbortSignal): Promise<boolean> {
    return this.loadOnce(`raven:${key}`, async () => {
      const cached = await this.cache.get<CachedTile>(`raven:${key}`);
      if (cached && cached.stamp === index.dataTimestamp) {
        this.addCameras(cached.cameras);
        return true;
      }
      try {
        const response = await this.fetcher(new URL(`osm/tiles/${key}.json`, this.apiBase), { headers: { Accept: 'application/json' }, signal });
        if (!response.ok) throw new Error(`tile ${key}: HTTP ${response.status}`);
        const records = (await response.json()) as TileRecord[];
        const cameras = records.map(([id, lat, lon, tags]) => cameraFromNode(id, lat, lon, tags)).filter((camera): camera is Camera => camera !== null);
        await this.cache.set<CachedTile>(`raven:${key}`, { stamp: index.dataTimestamp, fetchedAt: Date.now(), cameras });
        this.addCameras(cameras);
        return true;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (cached) {
          this.addCameras(cached.cameras); // stale beats nothing
          return true;
        }
        return false;
      }
    });
  }

  private loadOverpassCell(key: string, tileSize: number, signal?: AbortSignal): Promise<boolean> {
    return this.loadOnce(`overpass:${key}`, async () => {
      const cached = await this.cache.get<CachedTile>(`overpass:${key}`);
      if (cached && Date.now() - cached.fetchedAt < OVERPASS_MAX_AGE_MS) {
        this.addCameras(cached.cameras);
        return true;
      }
      const body = new URLSearchParams({ data: overpassQuery(tileBounds(key, tileSize)) });
      for (const endpoint of this.options.overpassEndpoints ?? OVERPASS_ENDPOINTS) {
        try {
          const response = await this.fetcher(endpoint, { method: 'POST', body, signal });
          if (!response.ok) continue;
          const payload = (await response.json()) as { elements?: Array<{ type: string; id: number; lat: number; lon: number; tags?: Record<string, string> }> };
          const cameras = (payload.elements ?? [])
            .filter(element => element.type === 'node')
            .map(element => cameraFromNode(element.id, element.lat, element.lon, element.tags ?? {}))
            .filter((camera): camera is Camera => camera !== null);
          await this.cache.set<CachedTile>(`overpass:${key}`, { stamp: null, fetchedAt: Date.now(), cameras });
          this.addCameras(cameras);
          return true;
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
      if (cached) {
        this.addCameras(cached.cameras);
        return true;
      }
      return false;
    });
  }

  private async loadKeys(keys: Iterable<string>, signal?: AbortSignal): Promise<CoverageReport> {
    const index = await this.tileIndex();
    const tileSize = index?.tileSize ?? 0.5;
    const published = new Set(index?.tiles ?? []);
    const jobs: Array<() => Promise<boolean>> = [];
    let overpassCells = 0;
    let skipped = 0;
    for (const key of keys) {
      const [lon, lat] = tileCenter(key, tileSize);
      const covered = index ? coverageContains(index.coverage, lon, lat) || published.has(key) : false;
      if (covered) {
        // A covered tile Raven didn't publish simply has no cameras.
        if (published.has(key)) jobs.push(() => this.loadRavenTile(index!, key, signal));
      } else if (overpassCells < MAX_OVERPASS_CELLS) {
        overpassCells += 1;
        jobs.push(() => this.loadOverpassCell(key, tileSize, signal));
      } else {
        skipped += 1;
      }
    }
    let next = 0;
    let failed = skipped;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        if (!(await job())) failed += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, jobs.length) }, worker));
    return { complete: failed === 0, failedAreas: failed };
  }

  /** Loads camera data for every area within `margin` meters of the route. */
  async ensureLine(line: RouteLine, margin: number, signal?: AbortSignal): Promise<CoverageReport> {
    const index = await this.tileIndex();
    return this.loadKeys(tileKeysAlong(line, index?.tileSize ?? 0.5, margin + 100), signal);
  }

  /** Loads camera data for a map view; skipped when the view spans too many tiles. */
  async ensureBounds(bounds: Bounds, signal?: AbortSignal, maxTiles = 9): Promise<CoverageReport | null> {
    const index = await this.tileIndex();
    const tileSize = index?.tileSize ?? 0.5;
    const keys: string[] = [];
    for (let row = Math.floor(bounds.south / tileSize); row <= Math.floor(bounds.north / tileSize); row += 1) {
      for (let column = Math.floor(bounds.west / tileSize); column <= Math.floor(bounds.east / tileSize); column += 1) {
        keys.push(`${row}_${column}`);
      }
    }
    if (keys.length > maxTiles) return null;
    return this.loadKeys(keys, signal);
  }
}
