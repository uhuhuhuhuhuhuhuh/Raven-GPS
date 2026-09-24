import { describe, expect, it } from 'vitest';
import { ALPR, FLOCK, type RouteCamera } from './cameras';
import { advance, progress, simulatedFix, startNavigation, type Fix, type NavEvent, type NavState } from './navigation';
import { pointAlong } from './routeLine';
import { routeFor, straightLine } from '../test/fixtures';

const route = routeFor(straightLine(), 140);
const camera: RouteCamera = {
  camera: { id: 9, lon: -84.386, lat: 33.7501, kinds: FLOCK | ALPR, directions: [], label: 'Flock Safety plate reader' },
  along: 1300,
  offset: 11,
  point: [-84.386, 33.75]
};

function drive(to: number, step = 40, from = 0, initial?: NavState) {
  let state = initial ?? startNavigation(route, { announceStart: false }).state;
  const events: Array<NavEvent & { at: number }> = [];
  let time = 0;
  for (let along = from; along <= to; along += step) {
    const [lon, lat] = pointAlong(route.line, along);
    const fix: Fix = { lon, lat, speed: 13, heading: 90, accuracy: 5, time: (time += 3000) };
    const result = advance(route, [camera], state, fix, 'mi');
    state = result.state;
    events.push(...result.events.map(event => ({ ...event, at: along })));
  }
  return { state, events };
}

describe('navigation', () => {
  it('announces the start', () => {
    const { events } = startNavigation(route, { announceStart: true });
    expect(events).toEqual([{ type: 'speak', text: 'Drive east on Main Street.' }]);
  });

  it('gives an early heads-up and then the instruction for a turn', () => {
    const turnAt = route.line.cumulative[route.maneuvers[1].beginIndex];
    const { events } = drive(turnAt);
    const spoken = events.filter(event => event.type === 'speak' && !event.text.includes('plate reader'));
    expect(spoken[0]).toMatchObject({ text: expect.stringMatching(/^In (a quarter mile|\d+ feet), turn right onto Oak Street\.$/) });
    expect(turnAt - spoken[0].at).toBeLessThanOrEqual(450);
    expect(spoken[1]).toMatchObject({ text: 'Turn right onto Oak Street.' });
    expect(turnAt - spoken[1].at).toBeLessThanOrEqual(120);
    expect(spoken).toHaveLength(2);
  });

  it('warns once about a camera still on the route', () => {
    const { events } = drive(1400);
    const alerts = events.filter(event => event.type === 'camera');
    expect(alerts).toHaveLength(1);
    expect(1300 - alerts[0].at).toBeLessThanOrEqual(400);
    expect(events.some(event => event.type === 'speak' && /^Flock Safety plate reader ahead/.test(event.text))).toBe(true);
  });

  it('tracks progress: next maneuver, distance and time left', () => {
    const { state } = drive(400);
    const info = progress(route, [camera], state);
    expect(info.maneuver?.type).toBe(10);
    expect(info.remainingDistance).toBeCloseTo(route.length - 400, -1);
    expect(info.remainingTime).toBeGreaterThan(90);
    expect(info.remainingTime).toBeLessThan(115);
    expect(info.nextCamera?.distance).toBeCloseTo(900, -1);
  });

  it('reports leaving the route once, after a few seconds away from it', () => {
    let { state } = drive(400);
    const events: NavEvent[] = [];
    for (let second = 1; second <= 8; second += 1) {
      const fix: Fix = { lon: -84.395, lat: 33.753, speed: 10, heading: 0, accuracy: 8, time: 1_000_000 + second * 1000 };
      const result = advance(route, [camera], state, fix, 'mi');
      state = result.state;
      events.push(...result.events);
    }
    expect(events.filter(event => event.type === 'offRoute')).toHaveLength(1);
    expect(state.along).toBeCloseTo(400, -1); // progress is held while off the route
  });

  it('arrives at the destination', () => {
    const { state, events } = drive(route.length);
    expect(state.arrived).toBe(true);
    expect(events.filter(event => event.type === 'arrived')).toHaveLength(1);
    expect(events.at(-2)).toMatchObject({ type: 'speak', text: 'You have arrived at your destination.' });
  });

  it('simulates a drive at the route’s pace', () => {
    const start = simulatedFix(route, 0, 0);
    const half = simulatedFix(route, 35, 0);
    expect(start.lon).toBeCloseTo(-84.4, 5);
    expect(half.lon).toBeGreaterThan(-84.4);
    expect(simulatedFix(route, 1000, 0).lon).toBeCloseTo(-84.38, 4);
  });
});
