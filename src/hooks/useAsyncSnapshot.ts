import { useSyncExternalStore, useCallback } from 'react';

/**
 * Shared cache + useSyncExternalStore wrapper for async external data
 * (IndexedDB lists, network fetches, event-bus-driven stores). Written to
 * satisfy React 19's react-hooks/set-state-in-effect rule without the older
 * `useEffect(() => { refresh() }, [refresh])` idiom that the rule flags.
 *
 * ### Contract
 *
 * - Two consumers passing the same `key` share one cache entry, so a
 *   mutation broadcast anywhere in the app fans out to every mounted
 *   consumer. Choose keys with namespaces (e.g. `"garage:vehicles"`).
 * - The first mount for a key triggers `load()`. `getSnapshot` returns
 *   `initial` until the load resolves, then the loaded value.
 * - If `subscribe` is provided (typically wiring `garageEvents` or another
 *   pub/sub), each fired event marks the cache stale and triggers a
 *   refetch, notifying all consumers when the new value lands.
 * - `refresh()` force-refetches. Use after a mutation the caller made
 *   itself; garage-event-driven caches don't need it because the event
 *   handles the invalidation.
 *
 * ### Snapshot immutability
 *
 * React uses `Object.is` on the snapshot to decide whether to re-render.
 * `load()` must return a fresh reference on every call (a new array or a
 * new object), otherwise consumers won't re-render even when data changed.
 * The IndexedDB `list*` helpers already return fresh arrays.
 */

interface CacheEntry<T> {
  value: T;
  listeners: Set<() => void>;
  loadPromise: Promise<void> | null;
}

const registry = new Map<string, CacheEntry<unknown>>();

function getOrCreateEntry<T>(key: string, initial: T): CacheEntry<T> {
  const existing = registry.get(key);
  if (existing) return existing as CacheEntry<T>;
  const entry: CacheEntry<T> = {
    value: initial,
    listeners: new Set(),
    loadPromise: null,
  };
  registry.set(key, entry);
  return entry;
}

function emitChange<T>(entry: CacheEntry<T>): void {
  for (const l of entry.listeners) {
    try {
      l();
    } catch (err) {
      console.error('useAsyncSnapshot listener failed', err);
    }
  }
}

function ensureLoaded<T>(entry: CacheEntry<T>, load: () => Promise<T>): Promise<void> {
  if (entry.loadPromise) return entry.loadPromise;
  entry.loadPromise = load()
    .then((v) => {
      entry.value = v;
      emitChange(entry);
    })
    .catch((err) => {
      console.error('useAsyncSnapshot load failed', err);
    });
  return entry.loadPromise;
}

// ─── Test-only helpers on the internal store ─────────────────────────────
// Exposed so `useAsyncSnapshot.test.ts` can exercise the cache mechanics
// (subscribe / notify / invalidate / initial-load) without spinning up
// React, which would require @testing-library/react as a new dev dep.

/** @internal — test entry point */
export function __storeSubscribe<T>(
  key: string,
  initial: T,
  load: () => Promise<T>,
  onChange: () => void,
): () => void {
  const entry = getOrCreateEntry(key, initial);
  entry.listeners.add(onChange);
  void ensureLoaded(entry, load);
  return () => {
    entry.listeners.delete(onChange);
  };
}

/** @internal — test entry point */
export function __storeGetSnapshot<T>(key: string): T | undefined {
  return registry.get(key)?.value as T | undefined;
}

/** @internal — test entry point */
export async function __storeRefresh<T>(key: string, load: () => Promise<T>): Promise<void> {
  const entry = registry.get(key);
  if (!entry) return;
  entry.loadPromise = null;
  await ensureLoaded(entry as CacheEntry<T>, load);
}

/** @internal — test entry point */
export function __storeInvalidate<T>(key: string, load: () => Promise<T>): void {
  const entry = registry.get(key);
  if (!entry) return;
  entry.loadPromise = null;
  void ensureLoaded(entry as CacheEntry<T>, load);
}

/** @internal — test entry point */
export function __resetAsyncSnapshotRegistry(): void {
  registry.clear();
}

export interface UseAsyncSnapshotOptions<T> {
  /** Stable global identifier for the underlying data source. */
  key: string;
  /** Value returned before `load()` first resolves. */
  initial: T;
  /** Async fetcher. Must return a fresh reference each call. */
  load: () => Promise<T>;
  /** Optional external subscribe (e.g. garageEvents). Called once per mount. */
  subscribe?: (onChange: () => void) => () => void;
}

export interface UseAsyncSnapshotReturn<T> {
  /** Latest cached value; `initial` until the first load resolves. */
  data: T;
  /** Force a refetch. Callers that mutate the source directly should call
   *  this OR ensure the subscribe channel emits — pick one, not both. */
  refresh: () => Promise<void>;
}

export function useAsyncSnapshot<T>(
  options: UseAsyncSnapshotOptions<T>,
): UseAsyncSnapshotReturn<T> {
  const { key, initial, load, subscribe: externalSubscribe } = options;

  // Read the cache entry inside callbacks (never during render) so React 19's
  // react-hooks/refs + immutability rules stay happy. `key` never changes for
  // a given consumer, so keeping the lookup in the callbacks costs nothing.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const entry = getOrCreateEntry(key, initial);
      entry.listeners.add(onChange);
      void ensureLoaded(entry, load);
      const unsubscribeExternal = externalSubscribe?.(() => {
        entry.loadPromise = null;
        void ensureLoaded(entry, load);
      });
      return () => {
        entry.listeners.delete(onChange);
        unsubscribeExternal?.();
      };
    },
    [key, initial, load, externalSubscribe],
  );

  const getSnapshot = useCallback(
    () => (registry.get(key)?.value as T | undefined) ?? initial,
    [key, initial],
  );

  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(async () => {
    const entry = registry.get(key);
    if (!entry) return;
    entry.loadPromise = null;
    await ensureLoaded(entry as CacheEntry<T>, load);
  }, [key, load]);

  return { data, refresh };
}
