/**
 * Serializes requests to one service with a minimum gap between them. The FOSSGIS
 * routing server allows at most one request per second.
 */
export function createRequestQueue(minIntervalMs: number, now = () => Date.now(), sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  return function schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const run = async () => {
      signal?.throwIfAborted();
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      signal?.throwIfAborted();
      lastStart = now();
      return task();
    };
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  };
}
