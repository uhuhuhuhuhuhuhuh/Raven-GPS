import type { RouteCamera } from './cameras';
import { haversine, type LonLat } from './geo';
import { spokenDistance } from './format';
import { bearingAlong, locateOnLine, pointAlong } from './routeLine';
import type { Maneuver, Route, Units } from './valhalla';

export type Fix = {
  lon: number;
  lat: number;
  /** m/s, when the device reports it. */
  speed: number | null;
  /** Degrees, when the device reports it. */
  heading: number | null;
  /** Meters. */
  accuracy: number;
  /** Epoch milliseconds. */
  time: number;
};

export type NavState = {
  along: number;
  offset: number;
  /** Index of the next maneuver to perform. */
  next: number;
  spoken: Set<string>;
  offRouteSince: number | null;
  offRouteReported: boolean;
  arrived: boolean;
  /** Smoothed speed, m/s. */
  speed: number;
  lastFix: Fix | null;
  /** Direction for the map: GPS heading when moving, else the route's. */
  heading: number;
  /** Position snapped to the route while on it. */
  snapped: LonLat | null;
};

export type NavEvent =
  | { type: 'speak'; text: string }
  | { type: 'camera'; hit: RouteCamera; distance: number }
  | { type: 'offRoute' }
  | { type: 'arrived' };

const DESTINATION_TYPES = new Set([4, 5, 6]);
const DEFAULT_SPEED = 13;

export function isDestination(maneuver: Maneuver | undefined): boolean {
  return maneuver !== undefined && DESTINATION_TYPES.has(maneuver.type);
}

export function startNavigation(route: Route, options: { announceStart: boolean }): { state: NavState; events: NavEvent[] } {
  const state: NavState = {
    along: 0,
    offset: 0,
    next: Math.min(1, route.maneuvers.length - 1),
    spoken: new Set(),
    offRouteSince: null,
    offRouteReported: false,
    arrived: false,
    speed: 0,
    lastFix: null,
    heading: bearingAlong(route.line, 0),
    snapped: null
  };
  const first = route.maneuvers[0];
  const events: NavEvent[] = [];
  if (options.announceStart && first) events.push({ type: 'speak', text: first.verbalPre ?? first.instruction });
  state.spoken.add('0:near');
  return { state, events };
}

function maneuverStart(route: Route, index: number): number {
  const maneuver = route.maneuvers[index];
  return maneuver ? route.line.cumulative[Math.min(maneuver.beginIndex, route.line.cumulative.length - 1)] : route.length;
}

function nextManeuverIndex(route: Route, along: number, from: number): number {
  let index = Math.max(1, from);
  while (index < route.maneuvers.length - 1 && maneuverStart(route, index) <= along + 5) index += 1;
  return Math.min(index, route.maneuvers.length - 1);
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

export type Progress = {
  maneuver: Maneuver | undefined;
  following: Maneuver | undefined;
  distanceToManeuver: number;
  remainingDistance: number;
  remainingTime: number;
  nextCamera: { hit: RouteCamera; distance: number } | null;
};

export function progress(route: Route, cameras: RouteCamera[], state: NavState): Progress {
  const maneuver = route.maneuvers[state.next];
  const distanceToManeuver = Math.max(0, maneuverStart(route, state.next) - state.along);
  const current = route.maneuvers[state.next - 1];
  let remainingTime = current && current.length > 0 ? current.time * Math.min(1, distanceToManeuver / current.length) : 0;
  for (let index = state.next; index < route.maneuvers.length; index += 1) remainingTime += route.maneuvers[index].time;
  const upcoming = cameras.find(hit => hit.along >= state.along - 15);
  return {
    maneuver,
    following: route.maneuvers[state.next + 1],
    distanceToManeuver,
    remainingDistance: Math.max(0, route.length - state.along),
    remainingTime,
    nextCamera: upcoming ? { hit: upcoming, distance: Math.max(0, upcoming.along - state.along) } : null
  };
}

/** Advances navigation with a new position and returns what to say or do. */
export function advance(route: Route, cameras: RouteCamera[], previous: NavState, fix: Fix, units: Units): { state: NavState; events: NavEvent[] } {
  const state: NavState = { ...previous, spoken: new Set(previous.spoken) };
  const events: NavEvent[] = [];
  if (state.arrived) return { state, events };
  const position: LonLat = [fix.lon, fix.lat];

  // Speed: the device's when reported, else derived from consecutive fixes.
  let speed = fix.speed;
  if ((speed === null || !Number.isFinite(speed)) && previous.lastFix) {
    const seconds = (fix.time - previous.lastFix.time) / 1000;
    speed = seconds > 0 ? haversine([previous.lastFix.lon, previous.lastFix.lat], position) / seconds : null;
  }
  state.speed = speed !== null && Number.isFinite(speed) ? previous.speed * 0.5 + Math.max(0, speed) * 0.5 : previous.speed;
  state.lastFix = fix;
  const pace = Math.max(state.speed, 8) || DEFAULT_SPEED;

  // Locate on the route near the last position; fall back to the whole route after a jump.
  const window = Math.max(600, pace * 40);
  let located = locateOnLine(route.line, position, previous.along, window);
  const tolerance = Math.min(80, Math.max(35, fix.accuracy * 1.2 + 15));
  if (!located || located.offset > tolerance) {
    const anywhere = locateOnLine(route.line, position);
    if (anywhere && anywhere.offset <= tolerance && anywhere.along > previous.along) located = anywhere;
  }

  if (!located || located.offset > tolerance) {
    state.offset = located?.offset ?? Infinity;
    state.snapped = null;
    state.offRouteSince ??= fix.time;
    if (fix.heading !== null && state.speed > 2) state.heading = fix.heading;
    if (!state.offRouteReported && fix.time - state.offRouteSince >= 3000) {
      state.offRouteReported = true;
      events.push({ type: 'offRoute' });
    }
    return { state, events };
  }

  state.offRouteSince = null;
  state.offRouteReported = false;
  state.offset = located.offset;
  // Ignore small backwards GPS jitter.
  state.along = located.along < previous.along && previous.along - located.along < 20 ? previous.along : located.along;
  state.snapped = located.point;
  state.heading = fix.heading !== null && state.speed > 3 ? fix.heading : bearingAlong(route.line, state.along);

  // Maneuver bookkeeping and "continue for" announcements after long stretches.
  const before = state.next;
  state.next = nextManeuverIndex(route, state.along, state.next);
  if (state.next > before) {
    const completed = route.maneuvers[state.next - 1];
    if (completed?.verbalPost && completed.length > 3000 && !state.spoken.has(`${state.next - 1}:post`)) {
      state.spoken.add(`${state.next - 1}:post`);
      events.push({ type: 'speak', text: completed.verbalPost });
    }
  }

  const remaining = route.length - state.along;
  const destination = route.line.coordinates[route.line.coordinates.length - 1];
  if (remaining < 25 || (remaining < 60 && haversine(position, destination) < Math.max(25, fix.accuracy))) {
    state.arrived = true;
    const last = route.maneuvers[route.maneuvers.length - 1];
    events.push({ type: 'speak', text: last?.verbalPre ?? 'You have arrived at your destination.' });
    events.push({ type: 'arrived' });
    return { state, events };
  }

  // Turn announcements: an early heads-up, then the instruction itself.
  const maneuver = route.maneuvers[state.next];
  if (maneuver) {
    const distance = Math.max(0, maneuverStart(route, state.next) - state.along);
    const near = Math.max(70, pace * 9);
    const far = pace > 24 ? 2000 : pace > 15 ? 1000 : 450;
    const lead = route.maneuvers[state.next - 1];
    const destinationManeuver = isDestination(maneuver);
    if (distance <= near && !state.spoken.has(`${state.next}:near`)) {
      state.spoken.add(`${state.next}:near`).add(`${state.next}:far`);
      const text = destinationManeuver ? maneuver.verbalAlert ?? maneuver.instruction : maneuver.verbalPre ?? maneuver.instruction;
      events.push({ type: 'speak', text });
    } else if (distance <= far && distance > near + 150 && !state.spoken.has(`${state.next}:far`) && (lead?.length ?? 0) > far * 0.6) {
      state.spoken.add(`${state.next}:far`);
      const alert = maneuver.verbalAlert ?? maneuver.instruction;
      events.push({ type: 'speak', text: `In ${spokenDistance(distance, units)}, ${lowerFirst(alert)}` });
    }
  }

  // Heads-up for cameras still on the route.
  const alertDistance = pace > 20 ? 800 : 400;
  for (const hit of cameras) {
    const distance = hit.along - state.along;
    if (distance < -15) continue;
    if (distance > alertDistance) break;
    if (state.spoken.has(`camera:${hit.camera.id}`)) continue;
    state.spoken.add(`camera:${hit.camera.id}`);
    events.push({ type: 'camera', hit, distance: Math.max(0, distance) });
    events.push({ type: 'speak', text: `${hit.camera.label} ahead${distance > 60 ? ` in ${spokenDistance(distance, units)}` : ''}.` });
  }
  return { state, events };
}

/** Positions along the route at driving pace, for previewing a drive without moving. */
export function simulatedFix(route: Route, elapsedSeconds: number, startTime: number, speedFactor = 1): Fix {
  let remaining = elapsedSeconds * speedFactor;
  let along = 0;
  for (let index = 0; index < route.maneuvers.length; index += 1) {
    const maneuver = route.maneuvers[index];
    if (maneuver.time <= 0 || maneuver.length <= 0) continue;
    if (remaining <= maneuver.time) {
      along = maneuverStart(route, index) + (remaining / maneuver.time) * maneuver.length;
      remaining = 0;
      break;
    }
    remaining -= maneuver.time;
    along = maneuverStart(route, index) + maneuver.length;
  }
  if (remaining > 0) along = route.length;
  const maneuver = route.maneuvers.find((item, index) => maneuverStart(route, index) <= along && maneuverStart(route, index) + item.length >= along);
  const speed = maneuver && maneuver.time > 0 ? maneuver.length / maneuver.time : DEFAULT_SPEED;
  const [lon, lat] = pointAlong(route.line, Math.min(along, route.length));
  return { lon, lat, speed, heading: bearingAlong(route.line, along), accuracy: 5, time: startTime + elapsedSeconds * 1000 };
}
