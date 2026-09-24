/** [longitude, latitude], the GeoJSON / MapLibre order used for every coordinate in the app. */
export type LonLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export function haversine(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0–360°. */
export function bearing(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Smallest absolute difference between two bearings, 0–180°. */
export function bearingDelta(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/** Meters per degree of longitude/latitude around `lat` (equirectangular; fine at street scale). */
export function metersPerDegree(lat: number): { lon: number; lat: number } {
  return { lon: 111_320 * Math.cos(lat * RAD), lat: 110_574 };
}

export type SegmentProjection = { t: number; distance: number; point: LonLat };

/** Closest point to `p` on segment a–b, computed in a local flat projection. */
export function projectOnSegment(p: LonLat, a: LonLat, b: LonLat): SegmentProjection {
  const scale = metersPerDegree(p[1]);
  const ax = (a[0] - p[0]) * scale.lon;
  const ay = (a[1] - p[1]) * scale.lat;
  const bx = (b[0] - p[0]) * scale.lon;
  const by = (b[1] - p[1]) * scale.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { t, distance: Math.hypot(x, y), point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

/** A point `meters` from `origin` towards `bearingDegrees`. */
export function offsetPoint(origin: LonLat, meters: number, bearingDegrees: number): LonLat {
  const scale = metersPerDegree(origin[1]);
  const radians = bearingDegrees * RAD;
  return [origin[0] + (Math.sin(radians) * meters) / scale.lon, origin[1] + (Math.cos(radians) * meters) / scale.lat];
}

export type Bounds = { west: number; south: number; east: number; north: number };

export function boundsOf(points: LonLat[]): Bounds {
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const [lon, lat] of points) {
    bounds.west = Math.min(bounds.west, lon);
    bounds.east = Math.max(bounds.east, lon);
    bounds.south = Math.min(bounds.south, lat);
    bounds.north = Math.max(bounds.north, lat);
  }
  return bounds;
}
