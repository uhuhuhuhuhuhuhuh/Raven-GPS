import { describe, expect, it, vi } from 'vitest';
import { buildRouteLine } from './routeLine';
import { displayLimit, fetchSpeedLimits, limitAt, spansFromTrace } from './speedLimits';
import { straightLine } from '../test/fixtures';

const line = buildRouteLine(straightLine()); // 41 segments, ~46 m each

describe('speed limits', () => {
  it('turns traced edges into merged spans in meters', () => {
    const spans = spansFromTrace({
      units: 'kilometers',
      edges: [
        { speed_limit: 50, begin_shape_index: 0, end_shape_index: 5 },
        { speed_limit: 50, begin_shape_index: 5, end_shape_index: 10 },
        { begin_shape_index: 10, end_shape_index: 12 },
        { speed_limit: 80, begin_shape_index: 12, end_shape_index: 20 }
      ]
    }, line);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ from: 0, kph: 50 });
    expect(spans[0].to).toBeCloseTo(line.cumulative[10], 6);
    expect(spans[1].kph).toBe(80);
  });

  it('converts mile-based traces and finds the limit at a distance', () => {
    const spans = spansFromTrace({ units: 'miles', edges: [{ speed_limit: 35, begin_shape_index: 0, end_shape_index: 10 }] }, line);
    expect(limitAt(spans, 100)).toBeCloseTo(56.3, 1);
    expect(limitAt(spans, line.cumulative[10] + 1)).toBeNull();
    expect(limitAt([], 100)).toBeNull();
  });

  it('rounds display values to posted numbers', () => {
    expect(displayLimit(56.3, 'mi')).toBe(35);
    expect(displayLimit(88.5, 'mi')).toBe(55);
    expect(displayLimit(48, 'km')).toBe(50);
  });

  it('asks trace_attributes with the route shape and tolerates failure', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.filters.attributes).toContain('edge.speed_limit');
      expect(typeof body.encoded_polyline).toBe('string');
      return new Response(JSON.stringify({ units: 'kilometers', edges: [{ speed_limit: 40, begin_shape_index: 0, end_shape_index: 41 }] }), { status: 200 });
    });
    const spans = await fetchSpeedLimits(line, 'https://routing.test', undefined, fetchImpl as typeof fetch);
    expect(spans).toEqual([{ from: 0, to: line.length, kph: 40 }]);
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await fetchSpeedLimits(line, 'https://routing.test', undefined, failing as unknown as typeof fetch)).toEqual([]);
  });
});
