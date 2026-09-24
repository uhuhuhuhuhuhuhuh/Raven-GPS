import { describe, expect, it, vi } from 'vitest';
import { ALPR, CameraIndex, FLOCK, type Camera } from './cameras';
import { haversine, type LonLat } from './geo';
import { planRoutes, triangleAround, type CameraSource, type PlanRequest } from './planner';
import { RoutingError, type Route, type RouteRequest } from './valhalla';
import { routeFor, straightLine } from '../test/fixtures';

// Three ways from A to B: the direct street, a detour one block north, and one two blocks north.
const direct = routeFor(straightLine(), 120);
const detour = routeFor([[-84.4, 33.75], ...straightLine(-84.4, -84.38, 33.753), [-84.38, 33.75]], 150);
const farDetour = routeFor([[-84.4, 33.75], ...straightLine(-84.4, -84.38, 33.756), [-84.38, 33.75]], 180);

const flock = (id: number, lon: number, lat: number): Camera => ({ id, lon, lat, kinds: FLOCK | ALPR, directions: [], label: 'Flock Safety plate reader' });

function source(cameras: Camera[]): CameraSource {
  const index = new CameraIndex();
  index.add(cameras);
  return { ensureLine: async () => ({ complete: true }), alongLine: (line, radius, mask) => index.alongLine(line, radius, mask) };
}

/** A fake router: returns the first candidate none of whose blocked points is excluded. */
function router(candidates: Array<{ route: Route; blockedBy: LonLat[]; needsPolygon?: boolean }>) {
  const polygonCovers = (polygon: LonLat[], point: LonLat) => polygon.some(vertex => haversine(vertex, point) < 40);
  return vi.fn(async (request: RouteRequest) => {
    const excluded = (candidate: (typeof candidates)[number]) =>
      candidate.blockedBy.some(point =>
        (!candidate.needsPolygon && (request.excludeLocations ?? []).some(location => haversine(location, point) < 40)) ||
        (request.excludePolygons ?? []).some(polygon => polygonCovers(polygon, point))
      );
    const available = candidates.filter(candidate => !excluded(candidate));
    if (!available.length) throw new RoutingError('No path could be found for input', true, 400);
    return available.slice(0, 1 + (request.alternates ?? 0)).map(candidate => candidate.route);
  });
}

const base: Omit<PlanRequest, 'profiles'> = {
  origin: { lon: -84.4, lat: 33.75 },
  destination: { lon: -84.38, lat: 33.75 },
  preferences: { avoidTolls: false, avoidFerries: false, avoidHighways: false, units: 'mi', language: 'en-US' },
  avoid: { enabled: true, mask: FLOCK | ALPR, radius: 35 }
};

describe('planRoutes', () => {
  it('reroutes around each camera the candidate passes until the route is clean', async () => {
    const onDirect: LonLat = [-84.39, 33.7501];
    const onDetour: LonLat = [-84.385, 33.7531];
    const fetchRoutes = router([
      { route: direct, blockedBy: [[-84.39, 33.75]] },
      { route: detour, blockedBy: [[-84.385, 33.753]] },
      { route: farDetour, blockedBy: [] }
    ]);
    const options = await planRoutes({ ...base, profiles: ['fastest'] }, fetchRoutes, source([flock(1, ...onDirect), flock(2, ...onDetour)]));
    expect(fetchRoutes).toHaveBeenCalledTimes(3);
    expect(options.map(option => option.kind)).toEqual(['fastest', 'direct']);
    expect(options[0].route).toBe(farDetour);
    expect(options[0].cameras).toEqual([]);
    expect(options[0].avoided).toBe(1);
    expect(options[0].exclusions.map(exclusion => exclusion.cameraId).sort()).toEqual([1, 2]);
    expect(options[1].route).toBe(direct);
    expect(options[1].cameras.map(hit => hit.camera.id)).toEqual([1]);
    // Exclusions are sent at the point on the road, not at the camera pole.
    const excluded = fetchRoutes.mock.calls[1][0].excludeLocations![0];
    expect(excluded[1]).toBeCloseTo(33.75, 5);
  });

  it('falls back to a polygon on the road when a point exclusion does not take', async () => {
    const fetchRoutes = router([
      { route: direct, blockedBy: [[-84.39, 33.75]], needsPolygon: true },
      { route: detour, blockedBy: [] }
    ]);
    const options = await planRoutes({ ...base, profiles: ['fastest'] }, fetchRoutes, source([flock(1, -84.39, 33.7501)]));
    expect(fetchRoutes).toHaveBeenCalledTimes(3);
    expect(options[0].route).toBe(detour);
    expect(fetchRoutes.mock.calls[2][0].excludePolygons).toHaveLength(1);
  });

  it('keeps the last good route when exclusions leave no way through', async () => {
    const fetchRoutes = router([{ route: direct, blockedBy: [[-84.39, 33.75]] }]);
    const options = await planRoutes({ ...base, profiles: ['fastest'] }, fetchRoutes, source([flock(1, -84.39, 33.7501)]));
    expect(options).toHaveLength(1);
    expect(options[0].route).toBe(direct);
    expect(options[0].cameras.map(hit => hit.camera.id)).toEqual([1]);
  });

  it('marks cameras at the start or end as unavoidable without trying', async () => {
    const fetchRoutes = router([{ route: direct, blockedBy: [] }]);
    const options = await planRoutes({ ...base, profiles: ['fastest'] }, fetchRoutes, source([flock(1, -84.3995, 33.7501)]));
    expect(fetchRoutes).toHaveBeenCalledTimes(1);
    expect(options[0].cameras).toHaveLength(1);
  });

  it('only counts cameras when avoidance is off', async () => {
    const fetchRoutes = router([{ route: direct, blockedBy: [[-84.39, 33.75]] }, { route: detour, blockedBy: [] }]);
    const options = await planRoutes({ ...base, avoid: { ...base.avoid, enabled: false }, profiles: ['fastest', 'balanced', 'quiet'] }, fetchRoutes, source([flock(1, -84.39, 33.7501)]));
    expect(fetchRoutes).toHaveBeenCalledTimes(3);
    expect(fetchRoutes.mock.calls.every(([request]) => !request.excludeLocations)).toBe(true);
    expect(options.map(option => option.route)).toEqual([direct]); // identical routes are merged
    expect(options[0].cameras).toHaveLength(1);
  });

  it('offers one option per profile plus the router’s alternates, seeding later profiles', async () => {
    const quiet = routeFor([[-84.4, 33.75], ...straightLine(-84.4, -84.38, 33.76), [-84.38, 33.75]], 260);
    const fetchRoutes = vi.fn(async (request: RouteRequest) => {
      if (request.profile === 'quiet') return [quiet];
      const blocked = (request.excludeLocations ?? []).length > 0;
      return blocked ? [detour, farDetour] : [direct, farDetour];
    });
    const seen: string[] = [];
    const options = await planRoutes(
      { ...base, profiles: ['fastest', 'balanced', 'quiet'], alternates: true, onOption: option => seen.push(option.kind) },
      fetchRoutes,
      source([flock(1, -84.39, 33.7501)])
    );
    expect(seen).toEqual(['fastest', 'alternate', 'quiet', 'direct']);
    expect(options.find(option => option.kind === 'fastest')?.route).toBe(detour);
    // Balanced started from fastest's exclusions and found the same route: merged away.
    const balancedCalls = fetchRoutes.mock.calls.filter(([request]) => request.profile === 'balanced');
    expect(balancedCalls).toHaveLength(1);
    expect(balancedCalls[0][0].excludeLocations).toHaveLength(1);
    expect(fetchRoutes.mock.calls.filter(([request]) => request.profile === 'fastest').every(([request]) => request.alternates === 2)).toBe(true);
  });

  it('stops wholesale detours that make things worse and detours one camera at a time instead', async () => {
    // Direct passes cameras 1 and 2. Avoiding only camera 1 is a short hop back to the main
    // street; avoiding both lands on a street with three more cameras.
    const partial = routeFor([[-84.4, 33.75], ...straightLine(-84.4, -84.39, 33.753), ...straightLine(-84.39, -84.38, 33.75)], 130);
    const worse = routeFor([[-84.4, 33.75], ...straightLine(-84.4, -84.38, 33.756), [-84.38, 33.75]], 170);
    const near = (points: LonLat[] | undefined, lon: number) => (points ?? []).some(point => Math.abs(point[0] - lon) < 0.0004 && Math.abs(point[1] - 33.75) < 0.0004);
    const fetchRoutes = vi.fn(async (request: RouteRequest) => {
      const one = near(request.excludeLocations, -84.395);
      const two = near(request.excludeLocations, -84.385);
      return [one && two ? worse : one ? partial : two ? worse : direct];
    });
    const cameras = source([
      flock(1, -84.395, 33.7501),
      flock(2, -84.385, 33.7501),
      flock(3, -84.395, 33.7561),
      flock(4, -84.39, 33.7561),
      flock(5, -84.385, 33.7561)
    ]);
    const options = await planRoutes({ ...base, profiles: ['fastest'] }, fetchRoutes, cameras);
    expect(options[0].route).toBe(partial);
    expect(options[0].cameras.map(hit => hit.camera.id)).toEqual([2]);
    expect(options[0].avoided).toBe(1);
    expect(options[1]).toMatchObject({ kind: 'direct' });
    // Direct, two wholesale rounds that got worse (then that phase stops), one try per camera site.
    expect(fetchRoutes).toHaveBeenCalledTimes(5);
  });

  it('builds closed exclusion triangles', () => {
    const triangle = triangleAround([-84.39, 33.75], 18);
    expect(triangle).toHaveLength(4);
    expect(triangle[0]).toEqual(triangle[3]);
    expect(haversine(triangle[0], [-84.39, 33.75])).toBeCloseTo(18, 0);
  });
});
