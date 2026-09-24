import { throwIfAborted } from './signals';
import { cameraSites, type RouteCamera } from './cameras';
import { offsetPoint, type LonLat } from './geo';
import type { RouteLine } from './routeLine';
import {
  MAX_EXCLUDE_LOCATIONS,
  MAX_EXCLUDE_POLYGON_VERTICES,
  RoutingError,
  type ProfileId,
  type Route,
  type RouteFetcher,
  type RoutePreferences,
  type Waypoint
} from './valhalla';

export type AvoidSettings = {
  /** Route around cameras (otherwise they are only counted and announced). */
  enabled: boolean;
  /** Camera kinds (bit flags from cameras.ts) to avoid or announce. */
  mask: number;
  /** A route passing within this many meters of a camera counts as passing it. */
  radius: number;
};

/** Where the planner gets camera data; implemented by CameraRepository + CameraIndex. */
export type CameraSource = {
  ensureLine(line: RouteLine, margin: number, signal?: AbortSignal): Promise<{ complete: boolean }>;
  alongLine(line: RouteLine, radius: number, mask: number): RouteCamera[];
};

/** One road exclusion sent to the router for a camera. */
export type Exclusion = { cameraId: number; location?: LonLat; polygon?: LonLat[] };

export type OptionKind = ProfileId | 'alternate' | 'direct';

export type RouteOption = {
  id: string;
  kind: OptionKind;
  route: Route;
  /** Cameras (of the configured kinds) this route still passes, in driving order. */
  cameras: RouteCamera[];
  /** How many cameras the unmodified fastest route passes that this one doesn't. */
  avoided: number;
  /** Exclusions that produced this route, reused when rerouting. */
  exclusions: Exclusion[];
  /** False when camera data couldn't be loaded for part of the route. */
  dataComplete: boolean;
};

export type PlanProgress = { kind: OptionKind; round: number; excluded: number };

export type PlanRequest = {
  origin: Waypoint;
  destination: Waypoint;
  profiles: ProfileId[];
  preferences: RoutePreferences;
  avoid: AvoidSettings;
  /** Exclusions to start from (e.g. the current route's, when rerouting). */
  seed?: Exclusion[];
  /** Offer the router's alternates to the fastest profile as extra options. */
  alternates?: boolean;
  /** Router requests per profile (defaults: 10 for fastest, 5 for the others). */
  budget?: number;
  signal?: AbortSignal;
  onOption?: (option: RouteOption, options: RouteOption[]) => void;
  onProgress?: (progress: PlanProgress) => void;
  /** The first route the router returns, so a map can show something while the search runs. */
  onPreview?: (route: Route, cameras: RouteCamera[]) => void;
};

const DEFAULT_BUDGET: Record<ProfileId, number> = { fastest: 10, balanced: 5, quiet: 5 };
/** A camera this close to the start or end can't be avoided without skipping the trip. */
const ENDPOINT_ZONE_M = 150;
const TRIANGLE_VERTICES = 4;
const MAX_POLYGONS = Math.floor(MAX_EXCLUDE_POLYGON_VERTICES / TRIANGLE_VERTICES);
const POLYGON_RADIUS_M = 18;

/** A closed triangle around `center`, blocking the road there (the fallback when a point exclusion didn't take). */
export function triangleAround(center: LonLat, radius: number): LonLat[] {
  const points = [0, 120, 240].map(angle => offsetPoint(center, radius, angle));
  return [...points, points[0]];
}

type Exclusions = Map<number, Exclusion>;

function copyExclusions(source: Iterable<Exclusion>): Exclusions {
  return new Map([...source].map(exclusion => [exclusion.cameraId, { ...exclusion }]));
}

function counts(exclusions: Exclusions) {
  let locations = 0;
  let polygons = 0;
  for (const exclusion of exclusions.values()) {
    if (exclusion.location) locations += 1;
    if (exclusion.polygon) polygons += 1;
  }
  return { locations, polygons };
}

function requestExclusions(exclusions: Exclusions) {
  const excludeLocations: LonLat[] = [];
  const excludePolygons: LonLat[][] = [];
  for (const exclusion of exclusions.values()) {
    if (exclusion.location) excludeLocations.push(exclusion.location);
    if (exclusion.polygon) excludePolygons.push(exclusion.polygon);
  }
  return { excludeLocations, excludePolygons };
}

function nearEnds(hit: RouteCamera, route: Route): boolean {
  return hit.along < ENDPOINT_ZONE_M || route.length - hit.along < ENDPOINT_ZONE_M;
}

/**
 * Excludes the road past `hit`: a point on the road first (the router drops the road
 * nearest it); if the route still passes the camera, a small polygon on the road
 * actually used. Returns false when that is exhausted or over the server's limits.
 */
function excludeHit(exclusions: Exclusions, hit: RouteCamera): boolean {
  const { locations, polygons } = counts(exclusions);
  const existing = exclusions.get(hit.camera.id);
  if (!existing) {
    if (locations < MAX_EXCLUDE_LOCATIONS) exclusions.set(hit.camera.id, { cameraId: hit.camera.id, location: hit.point });
    else if (polygons < MAX_POLYGONS) exclusions.set(hit.camera.id, { cameraId: hit.camera.id, polygon: triangleAround(hit.point, POLYGON_RADIUS_M) });
    else return false;
    return true;
  }
  if (existing.polygon || polygons >= MAX_POLYGONS) return false;
  existing.polygon = triangleAround(hit.point, POLYGON_RADIUS_M);
  return true;
}

function sameRoute(a: Route, b: Route): boolean {
  return Math.abs(a.length - b.length) <= Math.max(30, a.length * 0.005) && Math.abs(a.time - b.time) <= Math.max(15, a.time * 0.005);
}

type Candidate = { route: Route; hits: RouteCamera[]; complete: boolean; exclusions: Exclusion[] };

/** Fewer cameras wins, then the quicker drive; detours beyond `cap` seconds only win against each other. */
function better(candidate: Candidate, incumbent: Candidate | null, cap: number): boolean {
  if (!incumbent) return true;
  const over = candidate.route.time > cap;
  if (over !== incumbent.route.time > cap) return !over;
  if (candidate.hits.length !== incumbent.hits.length) return candidate.hits.length < incumbent.hits.length;
  return candidate.route.time < incumbent.route.time;
}

/**
 * Plans an option per profile, plus router alternates and (when avoiding cameras) the
 * unmodified fastest route for comparison, reporting each through `onOption` as it is
 * ready. With avoidance on, each profile searches for the route passing the fewest
 * cameras within a request budget:
 *
 * 1. Exclude the road past every camera the current route passes and ask again, while
 *    that keeps lowering the count. (In a dense area a wholesale detour can land on
 *    streets with even more cameras; then this phase stops.)
 * 2. From the best route so far, try detouring around one camera site at a time and keep
 *    each detour that lowers the count.
 *
 * Every route the router returns, alternates included, is a candidate.
 */
export async function planRoutes(request: PlanRequest, fetchRoutes: RouteFetcher, cameras: CameraSource): Promise<RouteOption[]> {
  const { avoid, signal } = request;
  const avoiding = avoid.enabled && avoid.mask !== 0;
  const options: RouteOption[] = [];
  // Written from inside `ask`; kept in an object so TypeScript doesn't narrow them to null.
  const shared: { direct: Candidate | null; cap: number } = { direct: null, cap: Infinity };

  const evaluate = async (route: Route) => {
    const report = await cameras.ensureLine(route.line, avoid.radius, signal);
    return { hits: avoid.mask ? cameras.alongLine(route.line, avoid.radius, avoid.mask) : [], complete: report.complete };
  };

  const publish = (kind: OptionKind, candidate: Candidate) => {
    if (options.some(existing => sameRoute(existing.route, candidate.route))) return;
    const onRoute = new Set(candidate.hits.map(hit => hit.camera.id));
    const avoided = shared.direct ? shared.direct.hits.filter(hit => !onRoute.has(hit.camera.id)).length : 0;
    const option: RouteOption = { id: `${kind}-${options.length}`, kind, route: candidate.route, cameras: candidate.hits, avoided, exclusions: candidate.exclusions, dataComplete: candidate.complete };
    options.push(option);
    request.onOption?.(option, options);
  };

  let seed: Exclusion[] = request.seed ?? [];

  for (const profile of request.profiles) {
    throwIfAborted(signal);
    const budget = request.budget ?? DEFAULT_BUDGET[profile];
    const pool: Candidate[] = [];
    // Updated from inside `ask`.
    const search: { best: Candidate | null; requests: number } = { best: null, requests: 0 };

    const ask = async (exclusions: Exclusions): Promise<Candidate[] | null> => {
      search.requests += 1;
      request.onProgress?.({ kind: profile, round: search.requests - 1, excluded: exclusions.size });
      let routes: Route[];
      try {
        routes = await fetchRoutes(
          {
            origin: request.origin,
            destination: request.destination,
            profile,
            preferences: request.preferences,
            alternates: request.alternates && profile === 'fastest' ? 2 : 0,
            ...(avoiding ? requestExclusions(exclusions) : {})
          },
          signal
        );
      } catch (error) {
        // Exclusions that cut the destination off (or that the server refuses) just fail this try.
        if (pool.length && error instanceof RoutingError && (error.noRoute || error.status === 400)) return null;
        throw error;
      }
      const used = [...exclusions.values()].map(exclusion => ({ ...exclusion }));
      const found: Candidate[] = [];
      for (const route of routes) {
        const candidate: Candidate = { route, ...(await evaluate(route)), exclusions: used };
        if (!shared.direct && used.length === 0 && !request.seed?.length) shared.direct = candidate;
        if (shared.cap === Infinity) request.onPreview?.(route, candidate.hits);
        // Detours longer than twice the first route (or 20 minutes more) only win against each other.
        if (shared.cap === Infinity) shared.cap = Math.max(route.time * 2, route.time + 1200);
        found.push(candidate);
        pool.push(candidate);
        if (better(candidate, search.best, shared.cap)) search.best = candidate;
      }
      return found;
    };

    let found = await ask(copyExclusions(seed));
    if (avoiding && found) {
      // Phase 1: wholesale exclusion while it helps.
      const exclusions = copyExclusions(seed);
      let setbacks = 0;
      while (search.requests < budget && found?.[0].hits.length) {
        const current: Candidate = found[0];
        let changed = false;
        for (const hit of current.hits) if (!nearEnds(hit, current.route) && excludeHit(exclusions, hit)) changed = true;
        if (!changed) break;
        const next: Candidate[] | null = await ask(exclusions);
        if (!next) break;
        setbacks = next[0].hits.length >= current.hits.length ? setbacks + 1 : 0;
        found = next;
        if (setbacks >= 2) break;
      }

      // Phase 2: one camera site at a time, from the best route so far.
      const tried = new Set<number>();
      while (search.requests < budget && search.best?.hits.length) {
        const base: Candidate = search.best;
        const site = cameraSites(base.hits).find(group => !nearEnds(group[0], base.route) && group.every(hit => !tried.has(hit.camera.id)));
        if (!site) break;
        for (const hit of site) tried.add(hit.camera.id);
        const exclusions = copyExclusions(base.exclusions);
        if (!site.map(hit => excludeHit(exclusions, hit)).some(Boolean)) continue;
        await ask(exclusions);
      }
    }

    if (!search.best) continue;
    const chosen: Candidate = search.best;
    publish(profile, chosen);
    seed = chosen.exclusions;

    if (request.alternates && profile === 'fastest') {
      const extras = pool
        .filter(candidate => candidate !== chosen && (!avoiding || candidate.hits.length <= chosen.hits.length) && candidate.route.time <= shared.cap)
        .sort((left, right) => left.hits.length - right.hits.length || left.route.time - right.route.time);
      let added = 0;
      for (const candidate of extras) {
        if (added >= 2) break;
        const before = options.length;
        publish('alternate', candidate);
        if (options.length > before) added += 1;
      }
    }
  }

  const { direct } = shared;
  if (avoiding && direct && direct.hits.length > Math.min(...options.map(option => option.cameras.length))) publish('direct', direct);
  return options;
}
