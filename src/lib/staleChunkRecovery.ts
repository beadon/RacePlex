/**
 * Recovery for a lazy-loaded chunk whose dynamic `import()` 404s (Vite's
 * `vite:preloadError`) — a tab (or installed PWA) still running the chunk
 * graph of a deploy GitHub Pages has since replaced, or one caught between two
 * service-worker generations mid-update (see `vite.config.ts`'s
 * `registerType`/`skipWaiting` comments for the update-flow half of this bug).
 * There's no in-place recovery from a dead chunk URL — reload once to fetch
 * the current index.html and its matching chunk graph.
 *
 * Guarded by sessionStorage so a genuinely offline device doesn't loop; the
 * guard is meant to be cleared once the app actually mounts, so a *later*
 * deploy's stale chunk still gets its own reload rather than being silently
 * swallowed for the rest of the session.
 */
const STALE_CHUNK_RELOAD_KEY = "raceplex:reloadedForStaleChunk";

type ReadableStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * True the first time this is called in a session (and records that it was
 * called); false on a repeat, meaning a reload already happened and didn't
 * fix it, so reloading again would just loop.
 */
export function shouldReloadForStaleChunk(storage: ReadableStorage = sessionStorage): boolean {
  try {
    if (storage.getItem(STALE_CHUNK_RELOAD_KEY)) return false;
    storage.setItem(STALE_CHUNK_RELOAD_KEY, "1");
    return true;
  } catch {
    // Storage disabled (private browsing, quota) — reload anyway, just without the loop guard.
    return true;
  }
}

/** Call once the app has successfully mounted. */
export function clearStaleChunkReloadGuard(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(STALE_CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}
