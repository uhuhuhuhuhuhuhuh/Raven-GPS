import { describe, expect, it } from 'vitest';
import { bearing, bearingDelta, haversine, projectOnSegment } from './geo';
import { decodePolyline, encodePolyline } from './polyline';
import { bearingAlong, buildRouteLine, locateOnLine, pointAlong, sliceLine } from './routeLine';
import { straightLine } from '../test/fixtures';

describe('polyline', () => {
  it('decodes Valhalla precision-6 shapes', () => {
    // Two points in Miami, encoded by Valhalla.
    const points = decodePolyline(encodePolyline([[-80.1918, 25.7617], [-80.13, 25.7907]]));
    expect(points[0][0]).toBeCloseTo(-80.1918, 6);
    expect(points[1][1]).toBeCloseTo(25.7907, 6);
  });

  it('round-trips negative and tiny deltas', () => {
    const input: Array<[number, number]> = [[-122.419416, 37.774929], [-122.419415, 37.77493], [-122.4, 37.8]];
    expect(decodePolyline(encodePolyline(input))).toEqual(input);
  });

  it('rejects truncated input', () => {
    expect(() => decodePolyline('_p~iF')).toThrow(/Truncated/);
  });
});

describe('geo', () => {
  it('measures distances and bearings', () => {
    expect(haversine([-84.4, 33.75], [-84.39, 33.75])).toBeCloseTo(925, -1);
    expect(bearing([-84.4, 33.75], [-84.39, 33.75])).toBeCloseTo(90, 0);
    expect(bearingDelta(350, 10)).toBe(20);
  });

  it('projects onto a segment and clamps to its ends', () => {
    const projection = projectOnSegment([-84.395, 33.7501], [-84.4, 33.75], [-84.39, 33.75]);
    expect(projection.t).toBeCloseTo(0.5, 2);
    expect(projection.distance).toBeCloseTo(11, 0);
    expect(projectOnSegment([-84.5, 33.75], [-84.4, 33.75], [-84.39, 33.75]).t).toBe(0);
  });
});

describe('route line', () => {
  const line = buildRouteLine(straightLine());

  it('locates positions along the line', () => {
    const position = locateOnLine(line, [-84.39, 33.7502])!;
    expect(position.along).toBeCloseTo(925, -1);
    expect(position.offset).toBeCloseTo(22, 0);
  });

  it('limits the search to a window ahead of the last position', () => {
    const doubledBack = buildRouteLine([...straightLine(), ...straightLine().reverse()]);
    const early = locateOnLine(doubledBack, [-84.39, 33.75], 0, 1200)!;
    const late = locateOnLine(doubledBack, [-84.39, 33.75], 2500, 1200)!;
    expect(early.along).toBeLessThan(1000);
    expect(late.along).toBeGreaterThan(2500);
  });

  it('interpolates points, bearings and slices', () => {
    expect(pointAlong(line, 925)[0]).toBeCloseTo(-84.39, 3);
    expect(bearingAlong(line, 100)).toBeCloseTo(90, 0);
    const slice = sliceLine(line, 500, 1000);
    expect(haversine(slice[0], slice[slice.length - 1])).toBeCloseTo(500, -1);
  });
});
