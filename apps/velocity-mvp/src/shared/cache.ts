interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const store = new Map<string, CacheEntry<unknown>>();
const DEFAULT_MAX_ENTRIES = 512;
let maxEntries = DEFAULT_MAX_ENTRIES;

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}

function evictOldestIfNeeded(): void {
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value;
    if (!oldest) {
      return;
    }
    store.delete(oldest);
  }
}

export function configureCache(options: { maxEntries?: number }): void {
  if (typeof options.maxEntries === 'number' && Number.isFinite(options.maxEntries) && options.maxEntries > 0) {
    maxEntries = Math.floor(options.maxEntries);
    evictOldestIfNeeded();
  }
}

export function getCached<T>(key: string): T | undefined {
  pruneExpired();
  const entry = store.get(key);
  if (!entry) {
    return undefined;
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }

  // Refresh insertion order so hot keys are retained longer under pressure.
  store.delete(key);
  store.set(key, entry);
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    store.delete(key);
    return;
  }

  pruneExpired();
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  evictOldestIfNeeded();
}

export function deleteCached(key: string): boolean {
  return store.delete(key);
}

export function deleteCachedByPrefix(prefix: string): number {
  let deleted = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      deleted += 1;
    }
  }
  return deleted;
}

export function clearCache(): void {
  store.clear();
}

export function cacheEntryCount(): number {
  pruneExpired();
  return store.size;
}
