import { describe, expect, it } from 'vitest';
import { createRequestQueue } from './requestQueue';

describe('createRequestQueue', () => {
  it('spaces requests at least the minimum interval apart, in order', async () => {
    let clock = 0;
    const starts: number[] = [];
    const schedule = createRequestQueue(1000, () => clock, async ms => {
      clock += ms;
    });
    await Promise.all([1, 2, 3].map(id => schedule(async () => {
      starts.push(clock);
      return id;
    })));
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('keeps going after a failed request', async () => {
    const schedule = createRequestQueue(0);
    await expect(schedule(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(schedule(async () => 'ok')).resolves.toBe('ok');
  });
});
