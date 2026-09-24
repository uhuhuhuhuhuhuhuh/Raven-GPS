import { anySignal, timeoutSignal } from './signals';
import type { LonLat } from './geo';
import { decodePolyline } from './polyline';
import { createRequestQueue } from './requestQueue';
import { buildRouteLine, type RouteLine } from './routeLine';

/** FOSSGIS's public Valhalla server (the one behind openstreetmap.org's directions). */
export const DEFAULT_ROUTING_ENDPOINT = 'https://valhalla1.openstreetmap.de';
/** Server-side limits of the public server (exclusion requests beyond these are rejected). */
export const MAX_EXCLUDE_LOCATIONS = 50;
export const MAX_EXCLUDE_POLYGON_VERTICES = 100;

export type Units = 'mi' | 'km';
export type Waypoint = { lon: number; lat: number; heading?: number };

export type RoutePreferences = {
  avoidTolls: boolean;
  avoidFerries: boolean;
  avoidHighways: boolean;
  units: Units;
  language: string;
};

/** Route styles offered side by side. */
export type ProfileId = 'fastest' | 'balanced' | 'quiet';

export type Maneuver = {
  type: number;
  instruction: string;
  verbalAlert?: string;
  verbalPre?: string;
  verbalPost?: string;
  streetNames: string[];
  beginStreetNames: string[];
  beginIndex: number;
  endIndex: number;
  /** Meters. */
  length: number;
  /** Seconds. */
  time: number;
  exitNumber?: string;
  toward?: string;
  roundaboutExit?: number;
};

export type Route = {
  line: RouteLine;
  maneuvers: Maneuver[];
  /** Meters. */
  length: number;
  /** Seconds. */
  time: number;
  hasToll: boolean;
  hasHighway: boolean;
  hasFerry: boolean;
};

export type RouteRequest = {
  origin: Waypoint;
  destination: Waypoint;
  profile: ProfileId;
  preferences: RoutePreferences;
  excludeLocations?: LonLat[];
  excludePolygons?: LonLat[][];
  alternates?: number;
};

export class RoutingError extends Error {
  constructor(message: string, readonly noRoute = false, readonly status?: number) {
    super(message);
    this.name = 'RoutingError';
  }
}

export function costingOptions(profile: ProfileId, preferences: RoutePreferences): Record<string, number> {
  const base = { use_tolls: preferences.avoidTolls ? 0 : 0.5, use_ferry: preferences.avoidFerries ? 0 : 0.5 };
  const highways = preferences.avoidHighways ? 0 : undefined;
  switch (profile) {
    case 'fastest':
      return { ...base, use_highways: highways ?? 1 };
    case 'balanced':
      return { ...base, use_highways: highways ?? 0.35, use_distance: 0.2 };
    case 'quiet':
      // No free live-traffic feed exists, so "less traffic" keeps off the highways and
      // expressways where congestion builds, accepting a longer drive.
      return { ...base, use_highways: 0, use_tolls: 0, use_distance: 0.1 };
  }
}

export function buildRequestBody(request: RouteRequest): Record<string, unknown> {
  const location = (point: Waypoint, isOrigin: boolean) => ({
    lat: point.lat,
    lon: point.lon,
    ...(isOrigin && point.heading !== undefined ? { heading: Math.round(point.heading), heading_tolerance: 60 } : {})
  });
  const body: Record<string, unknown> = {
    locations: [location(request.origin, true), location(request.destination, false)],
    costing: 'auto',
    costing_options: { auto: costingOptions(request.profile, request.preferences) },
    directions_options: { units: request.preferences.units === 'mi' ? 'miles' : 'kilometers', language: request.preferences.language },
    ...(request.alternates ? { alternates: request.alternates } : {})
  };
  if (request.excludeLocations?.length) body.exclude_locations = request.excludeLocations.map(([lon, lat]) => ({ lat, lon }));
  if (request.excludePolygons?.length) body.exclude_polygons = request.excludePolygons;
  return body;
}

type ValhallaManeuver = {
  type: number;
  instruction: string;
  verbal_transition_alert_instruction?: string;
  verbal_pre_transition_instruction?: string;
  verbal_post_transition_instruction?: string;
  street_names?: string[];
  begin_street_names?: string[];
  begin_shape_index: number;
  end_shape_index: number;
  length: number;
  time: number;
  roundabout_exit_count?: number;
  sign?: {
    exit_number_elements?: Array<{ text: string }>;
    exit_toward_elements?: Array<{ text: string }>;
    exit_branch_elements?: Array<{ text: string }>;
  };
};
type ValhallaTrip = {
  legs: Array<{ shape: string; maneuvers: ValhallaManeuver[] }>;
  summary: { length: number; time: number; has_toll?: boolean; has_highway?: boolean; has_ferry?: boolean };
  units?: string;
};

export function parseTrip(trip: ValhallaTrip): Route {
  const unitMeters = trip.units === 'miles' ? 1609.344 : 1000;
  const coordinates: LonLat[] = [];
  const maneuvers: Maneuver[] = [];
  for (const leg of trip.legs) {
    const offset = Math.max(0, coordinates.length - 1);
    const shape = decodePolyline(leg.shape);
    coordinates.push(...(coordinates.length ? shape.slice(1) : shape));
    for (const maneuver of leg.maneuvers) {
      const exitNumber = maneuver.sign?.exit_number_elements?.map(element => element.text).join('/');
      const toward = (maneuver.sign?.exit_toward_elements ?? maneuver.sign?.exit_branch_elements)?.map(element => element.text).join(', ');
      maneuvers.push({
        type: maneuver.type,
        instruction: maneuver.instruction,
        verbalAlert: maneuver.verbal_transition_alert_instruction,
        verbalPre: maneuver.verbal_pre_transition_instruction,
        verbalPost: maneuver.verbal_post_transition_instruction,
        streetNames: maneuver.street_names ?? [],
        beginStreetNames: maneuver.begin_street_names ?? [],
        beginIndex: maneuver.begin_shape_index + offset,
        endIndex: maneuver.end_shape_index + offset,
        length: maneuver.length * unitMeters,
        time: maneuver.time,
        ...(exitNumber ? { exitNumber } : {}),
        ...(toward ? { toward } : {}),
        ...(maneuver.roundabout_exit_count ? { roundaboutExit: maneuver.roundabout_exit_count } : {})
      });
    }
  }
  const line = buildRouteLine(coordinates);
  return {
    line,
    maneuvers,
    length: line.length,
    time: trip.summary.time,
    hasToll: Boolean(trip.summary.has_toll),
    hasHighway: Boolean(trip.summary.has_highway),
    hasFerry: Boolean(trip.summary.has_ferry)
  };
}

export type RouteFetcher = (request: RouteRequest, signal?: AbortSignal) => Promise<Route[]>;

const queues = new Map<string, ReturnType<typeof createRequestQueue>>();

/** Valhalla /route client; returns the main route followed by any alternates. */
export function valhallaFetcher(endpoint = DEFAULT_ROUTING_ENDPOINT, fetchImpl: typeof fetch = (...args) => fetch(...args)): RouteFetcher {
  const base = endpoint.replace(/\/+$/, '');
  let queue = queues.get(base);
  if (!queue) {
    queue = createRequestQueue(base === DEFAULT_ROUTING_ENDPOINT ? 1100 : 200);
    queues.set(base, queue);
  }
  const schedule = queue;
  return (request, signal) =>
    schedule(async () => {
      const timeout = timeoutSignal(30_000);
      const response = await fetchImpl(`${base}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildRequestBody(request)),
        signal: signal ? anySignal([signal, timeout]) : timeout
      });
      const payload = (await response.json().catch(() => null)) as
        | { trip?: ValhallaTrip; alternates?: Array<{ trip: ValhallaTrip }>; error?: string; error_code?: number }
        | null;
      if (!response.ok || !payload?.trip) {
        const code = payload?.error_code;
        // 442/443: no path; 170/171: no road near a location.
        const noRoute = code !== undefined && [170, 171, 442, 443].includes(code);
        throw new RoutingError(payload?.error ?? `Routing failed (HTTP ${response.status})`, noRoute, response.status);
      }
      return [payload.trip, ...(payload.alternates ?? []).map(alternate => alternate.trip)].map(parseTrip);
    }, signal);
}
