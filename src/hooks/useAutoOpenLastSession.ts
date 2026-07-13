import { useEffect, useRef } from "react";

/**
 * Persistence + auto-open for the "last opened session" contract.
 *
 * Two localStorage keys drive it:
 *  - `session:lastOpen` — the file name of the most recently opened session.
 *    Written every time a session loads (via the trigger returned here).
 *  - `session:closedExplicitly` — `"1"` while the user has intentionally
 *    left a session via the header home button. Set when they close;
 *    cleared when they open anything.
 *
 * On mount, if `lastOpen` is set AND `closedExplicitly` isn't, `openFile`
 * runs once with the persisted file name — that's the "reload lands you
 * back in your session" case. If the user hit the home button before
 * closing the tab, the flag prevents the auto-open so they land on the
 * dashboard next time.
 *
 * Deliberately does NOT persist anything about *which* view was active
 * inside the session (Simple/Pro/Lap Times/etc.) — that stays in each
 * consumer hook where it belongs.
 */

const LAST_OPEN_KEY = "session:lastOpen";
const CLOSED_KEY = "session:closedExplicitly";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* full quota, private mode, etc. — best-effort */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

export interface UseAutoOpenLastSessionOptions {
  /** Whether a session is currently loaded — drives the persistence side. */
  currentFileName: string | null;
  /** How Index opens a file by name (already reused for the file-manager
   *  drawer row-click and the dashboard tile row-click). */
  openFile: (fileName: string) => void | Promise<void>;
}

/**
 * Track the last-open file name and auto-load it on cold start. Returns two
 * helpers so Index can wire them into the close + open flows:
 *
 *  - `markExplicitClose()` — call *before* clearing session state so the next
 *    startup lands on the dashboard.
 *  - `markSessionLoaded(fileName)` — call after any successful open so we
 *    persist the newest name and clear any stale close flag. Also called
 *    automatically as a side effect of `currentFileName` changing, so most
 *    callers don't need to invoke it directly.
 */
export function useAutoOpenLastSession({
  currentFileName,
  openFile,
}: UseAutoOpenLastSessionOptions): {
  markExplicitClose: () => void;
  markSessionLoaded: (fileName: string) => void;
} {
  // Only ever auto-open once per mount, no matter how many re-renders.
  const attemptedAutoOpen = useRef(false);

  useEffect(() => {
    if (attemptedAutoOpen.current) return;
    attemptedAutoOpen.current = true;
    // If a session is already loaded (e.g. leaderboard handoff on mount),
    // the auto-open path would race with it — skip.
    if (currentFileName) return;
    const last = safeGet(LAST_OPEN_KEY);
    const closed = safeGet(CLOSED_KEY);
    if (!last || closed === "1") return;
    void openFile(last);
    // Intentionally excluding openFile/currentFileName from deps: this must
    // run at most once per mount, keyed on the ref, not on the values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the current file name any time it changes to a non-null value.
  // Also clears the "closed explicitly" flag whenever a session becomes
  // active — the mere act of opening a session implies "I want this back
  // next time I reload."
  useEffect(() => {
    if (currentFileName) {
      safeSet(LAST_OPEN_KEY, currentFileName);
      safeRemove(CLOSED_KEY);
    }
  }, [currentFileName]);

  return {
    markExplicitClose: () => safeSet(CLOSED_KEY, "1"),
    markSessionLoaded: (fileName: string) => {
      safeSet(LAST_OPEN_KEY, fileName);
      safeRemove(CLOSED_KEY);
    },
  };
}
