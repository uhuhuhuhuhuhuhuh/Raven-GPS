import { afterEach, describe, expect, it, vi } from 'vitest';
import { anySignal, throwIfAborted, timeoutSignal } from './signals';

describe('signal fallbacks for older WebViews', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('combines signals without AbortSignal.any', () => {
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { any: undefined, timeout: undefined }));
    const first = new AbortController();
    const second = new AbortController();
    const combined = anySignal([first.signal, second.signal]);
    expect(combined.aborted).toBe(false);
    second.abort('stop');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('stop');
  });

  it('times out without AbortSignal.timeout', async () => {
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { any: undefined, timeout: undefined }));
    const signal = timeoutSignal(5);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(signal.aborted).toBe(true);
  });

  it('throws once aborted', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow();
  });
});
