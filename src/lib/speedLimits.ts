import type { LonLat } from './geo';
import { encodePolyline } from './polyline';
import { createRequestQueue } from './requestQueue';
import type { RouteLine } from './routeLine';
import { DEFAULT_ROUTING_ENDPOINT, type Units } from './valhalla';

/**
 * Posted speed limits along a route, from Valhalla's trace_attributes on the route's own
 * shape. Coverage follows OpenStreetMap's maxspeed tagging: near-complete on highways,
 * patchy on city streets, so a missing limit is normal and shown as nothing.
 */
export type SpeedLimitSpan = {
  /** Meters from the start of the route. */
  from: number;
  to: number;
  /** km/h. */
  kph: number;
};

type TraceEdge = { speed_limit?: number; begin_shape_index: number; end_shape_index: number };
type TraceResponse = { edges?: TraceEdge[]; units?: string };

const queues = new Map<string, ReturnType<typeof createRequestQueue>>();

export function spansFromTrace(trace: TraceResponse, line: RouteLine): SpeedLimitSpan[] {
  const miles = trace.units === 'miles';
  const spans: SpeedLimitSpan[] = [];
  const last = line.cumulative.length - 1;
  for (const edge of trace.edges ?? []) {
    if (!edge.speed_limit || edge.speed_limit <= 0) continue;
    const from = line.cumulative[Math.min(Math.max(edge.begin_shape_index, 0), last)];
    const to = line.cumulative[Math.min(Math.max(edge.end_shape_index, 0), last)];
    if (!(to > from)) continue;
    const kph = miles ? edge.speed_limit * 1.609344 : edge.speed_limit;
    const previous = spans[spans.length - 1];
    if (previous && previous.to === from && previous.kph === kph) previous.to = to;
    else spans.push({ from, to, kph });
  }
  return spans;
}

/** The limit in force `along` meters into the route, or null where none is mapped. */
export function limitAt(spans: SpeedLimitSpan[], along: number): number | null {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = spans[middle];
    if (along < span.from) high = middle - 1;
    else if (along >= span.to) low = middle + 1;
    else return span.kph;
  }
  return null;
}

/** Display value in the user's units, rounded to the posted number (25, 55, 30, 50…). */
export function displayLimit(kph: number, units: Units): number {
  return units === 'mi' ? Math.round(kph / 1.609344 / 5) * 5 : Math.round(kph / 5) * 5;
}

export async function fetchSpeedLimits(
  line: RouteLine,
  endpoint = DEFAULT_ROUTING_ENDPOINT,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = (...args) => fetch(...args)
): Promise<SpeedLimitSpan[]> {
  const base = endpoint.replace(/\/+$/, '');
  let queue = queues.get(base);
  if (!queue) {
    queue = createRequestQueue(base === DEFAULT_ROUTING_ENDPOINT ? 1100 : 200);
    queues.set(base, queue);
  }
  const coordinates: LonLat[] = line.coordinates;
  return queue(async () => {
    const response = await fetchImpl(`${base}/trace_attributes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal,
      body: JSON.stringify({
        shape_format: 'polyline6',
        encoded_polyline: encodePolyline(coordinates),
        costing: 'auto',
        shape_match: 'map_snap',
        filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index'], action: 'include' }
      })
    });
    if (!response.ok) return [];
    return spansFromTrace((await response.json()) as TraceResponse, line);
  }, signal);
}
