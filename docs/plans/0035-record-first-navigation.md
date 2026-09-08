# 0035 — Recording-first navigation; remove the duplicate Lap Timer entry

**Status:** done

## Problem

Three issues raised together:

1. On a constrained (phone) screen, starting a recording required scrolling
   past the dashboard's status row and session list down to the "Add data"
   section — recording a session is the app's primary purpose and deserved
   better than being one scroll-away tile among several.
2. "Tools" held a permanent slot in the bottom nav bar (Sessions / Garage /
   Tracks / Tools / Settings) despite being occasional-use (trackside
   calculators), competing evenly with destinations a rider actually needs
   every session.
3. The phone-GPS Lap Timer (`LapTimerTool`) was reachable two ways: the
   Tools picker's "Lap Timer" tile, and the dashboard's dedicated
   `RecordingModeDialog` → device picker → "This device" flow (which also
   mounts the exact same `LapTimerTool` component via `PhoneGpsRecord`).
   Two doors into recording is confusing; only one should exist.

## What changed

- **`AppShell.tsx`**: `AppShellActions.onOpenTools` replaced with
  `onBeginRecording`. The nav item it produces renders as a filled accent
  pill (`primary: true` on `NavItem`) instead of a plain icon+label, so it
  reads as *the* primary destination rather than one of several — matching
  how a workout app treats its record button.
- **`Dashboard.tsx`**: the nav bar's new "Record" destination opens the same
  `RecordingModeDialog` the existing "Record a session" tile already opens
  (`setRecordingModeOpen(true)`) — one dialog, two doors, not two
  implementations. `onOpenTools` moved off the nav `actions` and onto
  `SettingsModal`.
- **`SettingsModal.tsx`**: gained an `onOpenTools?` prop and a "Tools" row
  (icon + description + an "Open" button) right after the Profiles section,
  triggering the same `ToolsDialog` Dashboard already rendered.
- **`toolList.ts`**: deleted the `"laptimer"` entry. This is the *only*
  place removing it needed to happen — `ToolsPanel`'s picker, the in-session
  Tools tab, and the dashboard's `ToolsDialog` all read from this one array,
  and the real recording flow (`PhoneGpsRecord` → `LapTimerTool`) imports
  the component directly, untouched by this list. Also removed the three
  now-orphaned `laptimer.name`/`description`/`badge` i18n keys (the picker
  card's own copy) from all seven locale files — everything else under the
  `laptimer` namespace stays, since `LapTimerTool.tsx` itself still uses it.

## Verified live

`bun run dev` at a 616×615 viewport: bottom nav now shows Sessions / a
filled red **Record** pill / Garage / Tracks / Settings. Tapping Record
opens the "What are you recording?" dialog. Settings shows a "Tools" row
whose "Open" button opens the same Tools picker, now listing only Stance
Visualizer, Seat Position Visualizer, and My Data — no Lap Timer tile.

## Files

- `src/components/AppShell.tsx`, `src/pages/Dashboard.tsx`,
  `src/components/SettingsModal.tsx`, `src/plugins/tools/toolList.ts`.
- `src/plugins/tools/locales/*.json` (all 7) — orphaned key cleanup.
- `README.md` — "Tools" screen description updated (nav bar → Settings).

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2685 tests) /
`bun run build` all green, plus the live browser check above.
