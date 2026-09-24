/** Small persistent key-value cache (IndexedDB), so camera data survives restarts. */
export type TileCache = {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
};

const DB_NAME = 'raven-gps';
const STORE = 'camera-tiles';

export function memoryCache(): TileCache {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      values.set(key, value);
    }
  };
}

/** IndexedDB-backed cache; quietly degrades to memory where IndexedDB is unavailable. */
export function persistentCache(): TileCache {
  if (typeof indexedDB === 'undefined') return memoryCache();
  const fallback = memoryCache();
  let database: Promise<IDBDatabase | null> | null = null;
  const open = () => {
    database ??= new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return database;
  };
  const run = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> =>
    open().then(db => new Promise<T | undefined>(resolve => {
      if (!db) return resolve(undefined);
      try {
        const request = action(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    }));
  return {
    async get<T>(key: string) {
      return (await run<T>('readonly', store => store.get(key))) ?? fallback.get<T>(key);
    },
    async set<T>(key: string, value: T) {
      await fallback.set(key, value);
      await run('readwrite', store => store.put(value, key));
    }
  };
}
