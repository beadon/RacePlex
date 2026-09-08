/**
 * Hold-to-confirm progress — a press-and-hold gesture, not a tap, so a brief
 * accidental touch (a phone jostling in a pocket) can't trigger it. Used by
 * the phone-GPS recording lock overlay's unlock control: the overlay exists
 * specifically to survive incidental contact, so the way out of it must
 * require deliberate, sustained intent.
 *
 * Pure state machine — no timers of its own; the caller drives it with
 * `nowMs` (typically from a `requestAnimationFrame` loop) so it's fully
 * unit-testable without fake timers.
 */

export interface HoldState {
  /** `performance.now()`-style timestamp the hold began, or null when idle. */
  startedAtMs: number | null;
  /** 0-1 progress toward completion. 0 while idle. */
  progress: number;
}

export const IDLE_HOLD_STATE: HoldState = { startedAtMs: null, progress: 0 };

/** Begin a hold at `nowMs`. */
export function startHold(nowMs: number): HoldState {
  return { startedAtMs: nowMs, progress: 0 };
}

/** Release (or otherwise cancel) a hold before it completes. */
export function cancelHold(): HoldState {
  return IDLE_HOLD_STATE;
}

export interface HoldUpdate {
  state: HoldState;
  /** True exactly once, the update where progress first reaches 1. */
  justCompleted: boolean;
}

/**
 * Advance a hold to `nowMs`. A no-op (progress stays 0) when idle. Once
 * `durationMs` has elapsed since `startHold`, progress clamps at 1 and
 * `justCompleted` fires on that transition — the caller should treat that as
 * the confirm signal and reset to idle (`cancelHold()`) itself, since this
 * function doesn't auto-reset (so a caller polling on an interval doesn't
 * miss the completion tick).
 */
export function updateHold(state: HoldState, nowMs: number, durationMs: number): HoldUpdate {
  if (state.startedAtMs === null) return { state, justCompleted: false };
  const elapsed = nowMs - state.startedAtMs;
  const progress = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / durationMs));
  const justCompleted = progress >= 1 && state.progress < 1;
  return { state: { ...state, progress }, justCompleted };
}
