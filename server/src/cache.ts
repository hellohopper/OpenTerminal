type Entry = { value: unknown; expires: number };

// Caps the number of distinct keys each cache can hold. Keys are derived from
// caller-controlled input (symbols, search queries, etc.), so without a cap a
// remote caller could grow these maps without bound.
const MAX_STORE_ENTRIES = 1000;
const MAX_STALE_ENTRIES = 1000;

// Evicts the least-recently-used entry (Map iteration order = insertion order,
// and both `set` below re-insert on touch) until `map` is back under `max`.
function evictLru<V>(map: Map<string, V>, max: number): void {
  while (map.size > max) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  // Re-insert to mark as most-recently-used.
  store.delete(key);
  store.set(key, e);
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.delete(key);
  store.set(key, { value, expires: Date.now() + ttlMs });
  evictLru(store, MAX_STORE_ENTRIES);
}

// Stale entries are kept around so provider outages can fall back to last-known data.
// Bounded and LRU-evicted for the same reason as `store` above.
const staleStore = new Map<string, unknown>();

export function staleSet(key: string, value: unknown): void {
  staleStore.delete(key);
  staleStore.set(key, value);
  evictLru(staleStore, MAX_STALE_ENTRIES);
}

export function staleGet<T>(key: string): T | undefined {
  if (!staleStore.has(key)) return undefined;
  const value = staleStore.get(key) as T;
  staleStore.delete(key);
  staleStore.set(key, value);
  return value;
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  // Register before invoking the loader, including when it throws synchronously.
  const load = Promise.resolve().then(fn).then((value) => {
    cacheSet(key, value, ttlMs);
    staleSet(key, value);
    return value;
  }).catch((err) => {
    const stale = staleGet<T>(key);
    if (stale !== undefined) return stale;
    throw err;
  });
  // Caller-controlled keys must not grow the pending registry without bound.
  if (inFlight.size < MAX_STORE_ENTRIES) inFlight.set(key, load);
  try {
    return await load;
  } finally {
    if (inFlight.get(key) === load) inFlight.delete(key);
  }
}

export function cacheStore(key: string, value: unknown, ttlMs: number): void {
  cacheSet(key, value, ttlMs);
  staleSet(key, value);
}

