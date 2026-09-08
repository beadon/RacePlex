# 0032 — VESC/BMS chips on session rows

**Status:** done

## Problem

A session recorded with a VESC and/or BMS sidecar (issues #58, #73) looks
identical to a plain GPS-only session in the Dashboard's Recent Sessions tile
and the file browser drawer — a rider has to open a session to find out
whether it actually carries that extra telemetry.

## What changed

`FileMetadata` gains `hasVescData?`/`hasBmsData?`, stamped once at record
time (the same moment the format decision between `.rplx`/`.rplive` already
gets made) rather than computed by inspecting the file's contents on every
list render. `ConcurrentSourceMerger.hasSecondary` — already the exact
signal `lapTimerSession.ts` uses to choose `.rplx` vs `.rplive` — is the
source for both new flags.

Stamped at all three save sites: `lapTimerSession.ts`'s `persist()`,
`RaceBoxLiveRecord.tsx`'s `handleSave`, `DragyLiveRecord.tsx`'s `handleSave`.

A new small pill component, `SidecarDataChips.tsx` (mirrors `FileTypeBadge`'s
exact styling), renders "VESC"/"BMS" chips next to the session name wherever
a row already shows other per-session badges: the Dashboard's
`RecentSessionsTile`, and both the local and cloud rows in the file browser's
`FilesTab`. `fileBrowserTree.ts`'s `BrowserSession` (the flattened per-row
shape both surfaces read from) carries the two flags through from
`FileMetadata`, alongside `isSample`/`fastestLapMs`.

Sessions recorded before this change have no flag set (`undefined` →
treated as `false`) — no retroactive backfill, matching how `sessionType`
(plan 0019) also only applies going forward.

## Files

- `src/lib/fileStorage.ts` — `FileMetadata.hasVescData?`/`hasBmsData?`.
- `src/plugins/tools/laptimer/lapTimerSession.ts`, `src/components/RaceBoxLiveRecord.tsx`,
  `src/components/DragyLiveRecord.tsx` — stamp both flags at save time.
- `src/lib/fileBrowserTree.ts` (+ test) — `BrowserSession` carries the flags.
- `src/components/SidecarDataChips.tsx` (new) — the chip component.
- `src/components/drawer/FilesTab.tsx`, `src/components/dashboard/RecentSessionsTile.tsx`
  — render the chips.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2665 tests) /
`bun run build` all green.
