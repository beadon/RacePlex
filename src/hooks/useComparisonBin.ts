/**
 * The comparison bin — a workflow-scoped Set of session file names the rider
 * has staged for side-by-side comparison (plan 0012 / issue #37).
 *
 * NOT persisted. This is a workflow, not a saved query: a rider picks 2+
 * sessions, hits Compare, and lands on `/compare`. If demand for saved
 * comparisons emerges we can add an IDB store; today it lives in memory
 * only.
 *
 * A single global instance so RecentSessionsTile, the file-manager drawer,
 * and any future selection surface all share the same bin without prop
 * threading. Subscribers are notified on every mutation via a shared
 * publisher (same pattern as garageEvents).
 */

import { useCallback, useSyncExternalStore } from "react";

const bin = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    try { l(); } catch (e) { console.warn("comparison-bin listener threw", e); }
  }
}

/** Add a file name to the bin. Idempotent. */
export function addToComparisonBin(fileName: string): void {
  if (bin.has(fileName)) return;
  bin.add(fileName);
  emit();
}

/** Remove a file name. No-op if absent. */
export function removeFromComparisonBin(fileName: string): void {
  if (!bin.has(fileName)) return;
  bin.delete(fileName);
  emit();
}

/** Toggle presence — the checkbox helper. */
export function toggleComparisonBin(fileName: string): void {
  if (bin.has(fileName)) {
    bin.delete(fileName);
  } else {
    bin.add(fileName);
  }
  emit();
}

/** Empty the bin (used after navigation into /compare, or an explicit clear). */
export function clearComparisonBin(): void {
  if (bin.size === 0) return;
  bin.clear();
  emit();
}

/** Snapshot the bin as a stable array (sorted for deterministic order). */
export function snapshotComparisonBin(): string[] {
  return [...bin].sort();
}

/** Subscribe (used by useSyncExternalStore in the hook + tests). */
export function subscribeComparisonBin(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * React hook that returns the current bin contents + toggle helper. Reruns
 * automatically when the bin changes. Values are stable across renders when
 * the bin hasn't changed (useSyncExternalStore contract).
 */
export function useComparisonBin(): {
  files: string[];
  size: number;
  has: (fileName: string) => boolean;
  toggle: (fileName: string) => void;
  clear: () => void;
} {
  // useSyncExternalStore requires a snapshot that's `Object.is`-stable when
  // nothing changed. `snapshotComparisonBin` returns a fresh array on every
  // call, so we memoize via a cache invalidated by the emitter.
  const files = useSyncExternalStore(subscribeComparisonBin, cachedSnapshot, cachedSnapshot);

  const has = useCallback((fileName: string) => files.includes(fileName), [files]);
  const toggle = useCallback((fileName: string) => toggleComparisonBin(fileName), []);
  const clear = useCallback(() => clearComparisonBin(), []);

  return { files, size: files.length, has, toggle, clear };
}

// ─── Snapshot cache — recomputed on every emit ─────────────────────────────
let cachedSnapshotArray: string[] = [];
let cacheValid = false;

function cachedSnapshot(): string[] {
  if (!cacheValid) {
    cachedSnapshotArray = snapshotComparisonBin();
    cacheValid = true;
  }
  return cachedSnapshotArray;
}

// Wire the cache invalidation into the same subscribe channel every hook
// uses, so cache + hooks always see the same generation.
subscribeComparisonBin(() => { cacheValid = false; });

/** Test hook — resets the bin AND its subscribers. Use in `beforeEach`. */
export function __resetComparisonBinForTests(): void {
  bin.clear();
  listeners.clear();
  cacheValid = false;
  cachedSnapshotArray = [];
  // Re-arm the cache-invalidation subscriber since we just cleared everything.
  subscribeComparisonBin(() => { cacheValid = false; });
}
