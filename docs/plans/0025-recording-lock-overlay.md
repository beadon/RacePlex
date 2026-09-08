# 0025 — A screen-lock overlay for phone-GPS recording

**Status:** done
**Date:** 2026-09-07

## Problem

[[0023-gps-recording-gap-detection]] traced a real data-loss bug to Android
Chrome stopping `watchPosition` delivery once the recording tab loses the
foreground or the screen sleeps — a plain web page can't prevent that outright.
`useWakeLock` (already wired into `LapTimerTool` for the whole session) keeps
the screen from auto-sleeping from inactivity, which covers the most common
case — a phone left untouched in a pocket. It can't do two other things: stop
an accidental tap from doing something (ending the session, navigating away)
while the screen stays lit in that pocket, and it can't override a deliberate
power-button press, which the Wake Lock API explicitly can't fight, by spec.

The user's own framing: *"other applications solve this problem by 'staying on
top' (Waze for example) — we could do the same, with a 'lock input' type of
button press to avoid accidental taps?"*

## What changed

**`lib/holdToConfirm.ts`** (new, pure): a press-and-hold progress state
machine — `startHold`/`cancelHold`/`updateHold`. A hold, not a tap, is the
unlock gesture specifically because the overlay exists to survive incidental
contact; the way out of it has to require deliberate, sustained intent. No
timers of its own — the caller drives it with `nowMs`, so it's fully
unit-tested without fake timers (7 cases: idle no-op, fractional progress,
clamping, single-fire completion, zero-duration edge case).

**`hooks/useHoldToConfirm.ts`** (new, thin): React/DOM binding — drives the
state machine off a `requestAnimationFrame` loop while a pointer is held,
exposing live 0-1 progress plus a single `onConfirm` call. Untested directly
(matches the existing `useWakeLock`/`wakeLock.ts` split in this codebase —
the pure logic is covered, the React glue isn't, since there's no
`@testing-library/react` dependency here). Two React-hooks-lint fixes worth
noting: the "latest onConfirm" ref is written inside a `useEffect`, not during
render (`react-hooks/refs`), and the rAF recursion uses a plain local function
defined fresh per press rather than a self-referencing `useCallback`
(`react-hooks/immutability` flags the latter as a hook self-reference, even
though the plain-closure version is ordinary JS).

**`plugins/tools/laptimer/RecordingLockOverlay.tsx`** (new): full-screen
overlay — a live speed readout, a circular "hold to unlock" control (an SVG
ring whose stroke-dashoffset animates with hold progress), and a hint that
repeats the precision dialog's power-button warning. Swallows every pointer
event except the unlock ring's own handlers.

**`plugins/tools/laptimer/LapTimerTool.tsx`**: a "Lock screen" button next to
"End" (shown whenever `phase !== "ended"`) sets `locked`; the overlay renders
when `locked && phase !== "ended"` — a derived condition, not an effect that
resets `locked` on end, since React's hooks-lint flags synchronous `setState`
inside an effect as cascading-render risk. `locked` itself gets reset directly
in the "New session"/"Start new session" button handlers instead, so a stale
`true` from a finished session doesn't reappear the instant a fresh one arms.

## Verified

- `holdToConfirm.test.ts`: 7 cases, all passing. `bun run
  lint`/`typecheck`/`test:run` (2,621 tests)/`build` all pass.
- Exercised the full flow in the running app: stubbed
  `navigator.geolocation.watchPosition` to feed a steady synthetic position,
  started a phone-GPS recording, confirmed the precision dialog's updated
  power-button copy (from 0023) still renders, tapped "Lock screen" and got
  the overlay ("RECORDING — SCREEN LOCKED", live speed, ring, hint text). A
  quick tap on the unlock ring did **not** unlock it (confirms the hold
  requirement actually resists a brief accidental touch); a sustained
  pointer-down did unlock it automatically once the hold duration elapsed,
  without needing to release first. Ended the session while previously locked
  and confirmed the "Session saved" screen appeared immediately, not blocked
  behind the lock overlay. Cleaned up the test session data afterward.

## Deliberately not done here

- No auto-lock — the rider taps "Lock screen" deliberately once they're ready
  to ride, rather than the app locking on a timer. Simpler, and matches how a
  rider actually uses this (confirm GPS/course looks right, then lock before
  pocketing the phone).
- Still can't survive a deliberate power-button press or switching to a
  different app entirely — those remain outside what any web page can
  override. The overlay's hint text says so plainly rather than implying a
  guarantee it can't back up.
