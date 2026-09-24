import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchCompass } from './compass';

type Listener = (event: Event) => void;

function fakeWindow() {
  const listeners = new Map<string, Listener[]>();
  const target = {
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== listener));
    },
    emit(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
    count: () => [...listeners.values()].reduce((total, list) => total + list.length, 0)
  };
  vi.stubGlobal('window', target);
  vi.stubGlobal('screen', { orientation: { angle: 0 } });
  return target;
}

afterEach(() => vi.unstubAllGlobals());

describe('watchCompass', () => {
  it('converts absolute alpha into a compass heading', () => {
    const target = fakeWindow();
    const seen: number[] = [];
    watchCompass(heading => seen.push(heading));
    target.emit('deviceorientationabsolute', { absolute: true, alpha: 90 });
    expect(seen).toEqual([270]);
  });

  it('ignores non-absolute orientation events', () => {
    const target = fakeWindow();
    const seen: number[] = [];
    watchCompass(heading => seen.push(heading));
    target.emit('deviceorientation', { absolute: false, alpha: 90 });
    expect(seen).toEqual([]);
  });

  it('suppresses jitter below the threshold, including across the 0/360 wrap', () => {
    const target = fakeWindow();
    const seen: number[] = [];
    watchCompass(heading => seen.push(heading), 5);
    target.emit('deviceorientationabsolute', { absolute: true, alpha: 0 });   // heading 0
    target.emit('deviceorientationabsolute', { absolute: true, alpha: 358 }); // heading 2: too small
    target.emit('deviceorientationabsolute', { absolute: true, alpha: 340 }); // heading 20: reported
    expect(seen).toEqual([0, 20]);
  });

  it('stop() removes its listeners', () => {
    const target = fakeWindow();
    const watch = watchCompass(() => {});
    expect(target.count()).toBe(2);
    watch.stop();
    expect(target.count()).toBe(0);
  });
});
