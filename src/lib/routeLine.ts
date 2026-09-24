import { bearing, haversine, projectOnSegment, type LonLat } from './geo';

/** A route polyline with cumulative distances, for locating positions along it. */
export type RouteLine = {
  coordinates: LonLat[];
  /** cumulative[i]: meters from the start to coordinates[i]. */
  cumulative: number[];
  length: number;
};

export function buildRouteLine(coordinates: LonLat[]): RouteLine {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + haversine(coordinates[index - 1], coordinates[index]));
  }
  return { coordinates, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

export type LinePosition = {
  /** Index of the segment's first vertex. */
  segment: number;
  /** Meters from the start of the line to the projected point. */
  along: number;
  /** Meters from the query point to the line. */
  offset: number;
  point: LonLat;
};

/**
 * Projects `point` onto the line. With `fromAlong`/`window`, only the stretch
 * [fromAlong - 30 m, fromAlong + window] is searched, so a position isn't snapped to a
 * later part of a route that doubles back past the same place.
 */
export function locateOnLine(line: RouteLine, point: LonLat, fromAlong?: number, window = Infinity): LinePosition | null {
  const { coordinates, cumulative } = line;
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return { segment: 0, along: 0, offset: haversine(point, coordinates[0]), point: coordinates[0] };
  const start = fromAlong === undefined ? 0 : fromAlong - 30;
  const end = fromAlong === undefined ? Infinity : fromAlong + window;
  let best: LinePosition | null = null;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    if (cumulative[index + 1] < start) continue;
    if (cumulative[index] > end) break;
    const projection = projectOnSegment(point, coordinates[index], coordinates[index + 1]);
    if (!best || projection.distance < best.offset) {
      const along = cumulative[index] + projection.t * (cumulative[index + 1] - cumulative[index]);
      best = { segment: index, along, offset: projection.distance, point: projection.point };
    }
  }
  return best;
}

/** The point `along` meters from the start (clamped to the line). */
export function pointAlong(line: RouteLine, along: number): LonLat {
  const { coordinates, cumulative } = line;
  if (along <= 0) return coordinates[0];
  if (along >= line.length) return coordinates[coordinates.length - 1];
  const segment = segmentAt(line, along);
  const span = cumulative[segment + 1] - cumulative[segment];
  const t = span === 0 ? 0 : (along - cumulative[segment]) / span;
  const [a, b] = [coordinates[segment], coordinates[segment + 1]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Direction of travel at `along` meters. */
export function bearingAlong(line: RouteLine, along: number): number {
  const { coordinates } = line;
  if (coordinates.length < 2) return 0;
  const segment = Math.min(segmentAt(line, along), coordinates.length - 2);
  return bearing(coordinates[segment], coordinates[segment + 1]);
}

function segmentAt(line: RouteLine, along: number): number {
  let low = 0;
  let high = line.cumulative.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (line.cumulative[middle] <= along) low = middle;
    else high = middle;
  }
  return low;
}

/** Portion of the line from `from` to `to` meters, for drawing the part still ahead. */
export function sliceLine(line: RouteLine, from: number, to = line.length): LonLat[] {
  if (from >= to) return [];
  const output: LonLat[] = [pointAlong(line, from)];
  for (let index = 0; index < line.coordinates.length; index += 1) {
    if (line.cumulative[index] > from && line.cumulative[index] < to) output.push(line.coordinates[index]);
  }
  output.push(pointAlong(line, to));
  return output;
}
