import { encodePolyline } from '../lib/polyline';
import type { LonLat } from '../lib/geo';
import { parseTrip, type Route } from '../lib/valhalla';

/** A straight west→east street in Atlanta, sampled every ~0.0005° (~46 m). */
export function straightLine(fromLon = -84.4, toLon = -84.38, lat = 33.75, step = 0.0005): LonLat[] {
  const points: LonLat[] = [];
  for (let lon = fromLon; lon <= toLon + 1e-9; lon += step) points.push([Number(lon.toFixed(6)), lat]);
  return points;
}

/** A Valhalla-shaped trip over `points`, with a turn half way and a destination maneuver. */
export function tripFor(points: LonLat[], options: { units?: 'miles' | 'kilometers'; seconds?: number } = {}) {
  const middle = Math.floor(points.length / 2);
  const units = options.units ?? 'kilometers';
  const seconds = options.seconds ?? 120;
  const route = parseTrip({ legs: [{ shape: encodePolyline(points), maneuvers: [] }], summary: { length: 0, time: seconds }, units });
  const perUnit = units === 'miles' ? 1609.344 : 1000;
  const firstLength = route.line.cumulative[middle] / perUnit;
  const secondLength = (route.line.length - route.line.cumulative[middle]) / perUnit;
  return {
    legs: [{
      shape: encodePolyline(points),
      maneuvers: [
        { type: 1, instruction: 'Drive east on Main Street.', verbal_pre_transition_instruction: 'Drive east on Main Street.', street_names: ['Main Street'], begin_shape_index: 0, end_shape_index: middle, length: firstLength, time: seconds / 2 },
        { type: 10, instruction: 'Turn right onto Oak Street.', verbal_transition_alert_instruction: 'Turn right onto Oak Street.', verbal_pre_transition_instruction: 'Turn right onto Oak Street.', street_names: ['Oak Street'], begin_shape_index: middle, end_shape_index: points.length - 1, length: secondLength, time: seconds / 2 },
        { type: 4, instruction: 'You have arrived at your destination.', verbal_transition_alert_instruction: 'You will arrive at your destination.', verbal_pre_transition_instruction: 'You have arrived at your destination.', begin_shape_index: points.length - 1, end_shape_index: points.length - 1, length: 0, time: 0 }
      ]
    }],
    summary: { length: (firstLength + secondLength), time: seconds, has_toll: false, has_highway: false, has_ferry: false },
    units
  };
}

export function routeFor(points: LonLat[], seconds = 120): Route {
  return parseTrip(tripFor(points, { seconds }));
}
