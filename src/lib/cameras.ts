import { bearing, bearingDelta, haversine, metersPerDegree, projectOnSegment, type Bounds, type LonLat } from './geo';
import type { RouteLine } from './routeLine';

/** Bit flags: a camera can be several at once (a Flock Falcon is a Flock device and a plate reader). */
export const FLOCK = 1;
export const ALPR = 2;
export const ENFORCEMENT = 4;

export type Camera = {
  id: number;
  lon: number;
  lat: number;
  kinds: number;
  /** Viewing directions in degrees, when mapped. */
  directions: number[];
  /** Short description, e.g. "Flock Safety plate reader". */
  label: string;
  operator?: string;
};

const FLOCK_WIKIDATA = 'Q108485435';
const FLOCK_NAME_KEYS = ['manufacturer', 'brand', 'operator', 'owner', 'model', 'name', 'network'];
const FLOCK_TEXT = /\bflock (safety|camera|alpr|lpr|falcon|sparrow|raven|condor|device)/i;

export function isFlock(tags: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(tags)) {
    if (key.endsWith('wikidata') && value.split(';').map(item => item.trim()).includes(FLOCK_WIKIDATA)) return true;
  }
  if (FLOCK_NAME_KEYS.some(key => /\bflock\b/i.test(tags[key] ?? ''))) return true;
  return FLOCK_TEXT.test(tags.description ?? '') || FLOCK_TEXT.test(tags.note ?? '');
}

export function isPlateReader(tags: Record<string, string>): boolean {
  const type = (tags['surveillance:type'] ?? '').toLowerCase();
  if (type.split(';').some(value => ['alpr', 'anpr', 'lpr'].includes(value.trim()))) return true;
  return /\b(falcon|sparrow)\b/i.test(tags.model ?? '') && isFlock(tags);
}

export function isEnforcement(tags: Record<string, string>): boolean {
  return tags.highway === 'speed_camera' || ['maxspeed', 'traffic_signals', 'average_speed'].includes(tags.enforcement ?? '');
}

export function classify(tags: Record<string, string>): number {
  return (isFlock(tags) ? FLOCK : 0) | (isPlateReader(tags) ? ALPR : 0) | (isEnforcement(tags) ? ENFORCEMENT : 0);
}

const CARDINALS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

/** OSM `direction`/`camera:direction`: degrees or cardinal points, possibly several ("90;270"). */
export function parseDirections(tags: Record<string, string>): number[] {
  const raw = tags['camera:direction'] ?? tags.direction ?? tags['surveillance:direction'] ?? '';
  return raw
    .split(';')
    .map(part => part.trim().toUpperCase())
    .filter(part => part !== '')
    .map(part => (part in CARDINALS ? CARDINALS[part] : Number(part)))
    .filter(value => Number.isFinite(value))
    .map(value => ((value % 360) + 360) % 360);
}

export function describe(kinds: number, tags: Record<string, string>): string {
  const detector = /gunshot|acoustic|audio/i.test(`${tags.model ?? ''} ${tags.description ?? ''} ${tags['surveillance:type'] ?? ''}`) || /\braven\b/i.test(tags.model ?? '');
  if (kinds & FLOCK) return detector ? 'Flock Safety gunshot detector' : kinds & ALPR ? 'Flock Safety plate reader' : 'Flock Safety device';
  if (kinds & ALPR) {
    const maker = tags.manufacturer ?? tags.brand;
    return maker ? `Plate reader (${maker})` : 'Plate reader';
  }
  if (kinds & ENFORCEMENT) return tags.enforcement === 'traffic_signals' ? 'Red-light camera' : 'Speed camera';
  return 'Camera';
}

/** Builds a Camera from an OSM node, or null when it is none of the kinds the app tracks. */
export function cameraFromNode(id: number, lat: number, lon: number, tags: Record<string, string>): Camera | null {
  const kinds = classify(tags);
  if (!kinds) return null;
  const operator = tags.operator && !/\bflock\b/i.test(tags.operator) ? tags.operator : undefined;
  return { id, lat, lon, kinds, directions: parseDirections(tags), label: describe(kinds, tags), ...(operator ? { operator } : {}) };
}

export type RouteCamera = {
  camera: Camera;
  /** Meters from the route start to the point where it passes the camera. */
  along: number;
  /** Meters between the camera and the route. */
  offset: number;
  /** Closest point on the route (on the road), used to exclude that road. */
  point: LonLat;
};

const CELL = 0.01;

/** Grid-bucketed camera store: fast radius and along-route queries. */
export class CameraIndex {
  private readonly cells = new Map<string, Camera[]>();
  private readonly byId = new Map<number, Camera>();

  get size(): number {
    return this.byId.size;
  }

  add(cameras: Iterable<Camera>): void {
    for (const camera of cameras) {
      if (this.byId.has(camera.id)) this.remove(camera.id);
      this.byId.set(camera.id, camera);
      const key = cellKey(camera.lon, camera.lat);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(camera);
      else this.cells.set(key, [camera]);
    }
  }

  get(id: number): Camera | undefined {
    return this.byId.get(id);
  }

  private remove(id: number): void {
    const camera = this.byId.get(id);
    if (!camera) return;
    const key = cellKey(camera.lon, camera.lat);
    const bucket = this.cells.get(key)?.filter(item => item.id !== id) ?? [];
    if (bucket.length) this.cells.set(key, bucket);
    else this.cells.delete(key);
    this.byId.delete(id);
  }

  private *inBox(west: number, south: number, east: number, north: number): Generator<Camera> {
    for (let x = Math.floor(west / CELL); x <= Math.floor(east / CELL); x += 1) {
      for (let y = Math.floor(south / CELL); y <= Math.floor(north / CELL); y += 1) {
        const bucket = this.cells.get(`${x}:${y}`);
        if (bucket) yield* bucket;
      }
    }
  }

  inBounds(bounds: Bounds, mask: number, limit = 5000): Camera[] {
    const output: Camera[] = [];
    for (const camera of this.inBox(bounds.west, bounds.south, bounds.east, bounds.north)) {
      if (!(camera.kinds & mask)) continue;
      if (camera.lon < bounds.west || camera.lon > bounds.east || camera.lat < bounds.south || camera.lat > bounds.north) continue;
      output.push(camera);
      if (output.length >= limit) break;
    }
    return output;
  }

  near(point: LonLat, radius: number, mask: number): Camera[] {
    const scale = metersPerDegree(point[1]);
    const dLon = radius / scale.lon;
    const dLat = radius / scale.lat;
    return [...this.inBox(point[0] - dLon, point[1] - dLat, point[0] + dLon, point[1] + dLat)]
      .filter(camera => camera.kinds & mask && haversine(point, [camera.lon, camera.lat]) <= radius);
  }

  /**
   * Cameras of `mask` within `radius` meters of the line, ordered by where the route
   * first passes them. A camera with a mapped viewing direction only counts where the
   * route runs along its line of sight (either way, within `axisTolerance` degrees):
   * crossing a camera's street at the intersection doesn't put a plate in front of it.
   */
  alongLine(line: RouteLine, radius: number, mask: number, axisTolerance = 50): RouteCamera[] {
    const found = new Map<number, RouteCamera>();
    const { coordinates, cumulative } = line;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const a = coordinates[index];
      const b = coordinates[index + 1];
      if (cumulative[index + 1] === cumulative[index]) continue;
      const scale = metersPerDegree(a[1]);
      const dLon = radius / scale.lon;
      const dLat = radius / scale.lat;
      const west = Math.min(a[0], b[0]) - dLon;
      const east = Math.max(a[0], b[0]) + dLon;
      const south = Math.min(a[1], b[1]) - dLat;
      const north = Math.max(a[1], b[1]) + dLat;
      let travel: number | null = null;
      for (const camera of this.inBox(west, south, east, north)) {
        if (!(camera.kinds & mask)) continue;
        const projection = projectOnSegment([camera.lon, camera.lat], a, b);
        if (projection.distance > radius) continue;
        if (camera.directions.length) {
          travel ??= bearing(a, b);
          const heading = travel;
          if (!camera.directions.some(direction => Math.min(bearingDelta(heading, direction), bearingDelta(heading, direction + 180)) <= axisTolerance)) continue;
        }
        const along = cumulative[index] + projection.t * (cumulative[index + 1] - cumulative[index]);
        const previous = found.get(camera.id);
        if (!previous) found.set(camera.id, { camera, along, offset: projection.distance, point: projection.point });
        else if (projection.distance < previous.offset && along - previous.along < 250) {
          found.set(camera.id, { camera, along, offset: projection.distance, point: projection.point });
        }
      }
    }
    return [...found.values()].sort((left, right) => left.along - right.along);
  }
}

/** Groups cameras the route passes within `gap` meters of each other (e.g. a pair on one pole). */
export function cameraSites(hits: RouteCamera[], gap = 40): RouteCamera[][] {
  const sites: RouteCamera[][] = [];
  for (const hit of hits) {
    const last = sites[sites.length - 1];
    if (last && hit.along - last[last.length - 1].along <= gap) last.push(hit);
    else sites.push([hit]);
  }
  return sites;
}

function cellKey(lon: number, lat: number): string {
  return `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;
}
