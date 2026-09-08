# 0019 — Recording mode: classify a session as you start it

**Status:** done
**Date:** 2026-09-07

## Problem

Issue #43 wants a drag-race session mode — 0-60, quarter-mile, trap speed —
alongside the existing lap-timing display, plus (per the issue) an honest
warning when the source can't measure it accurately. Before any of that
*display* work can happen, RacePlex needs to know, per session, what kind of
run it was: a rider recording a drag run vs. a track day vs. "just recording"
look identical in the data today. This plan is the classification half only —
picking the metrics to actually show per type is deferred (see the issue).

## Design

**Mode before device, not the other way round.** Dashboard's "Add data"
section collapses `RecordSessionTile` (new) + `RecordingModeDialog` (new) into
one entry point, replacing the direct `DevicesTile`/`ThisDeviceTile` tiles
from plan 0018: pick **Simple logger / Drag race logger / Track logger**
first, answer that mode's setup step, *then* choose This Device or External
Device — reusing `DevicesTile`/`ThisDeviceTile` unchanged, one level deeper.

- **Simple**: no setup step content beyond "nothing to configure."
- **Drag race**: a static precision warning (10-25 Hz logger vs. a 1 Hz phone
  or FIT device) — issue #43 wants this warning on the *result* too, using the
  session's actually-measured rate; that's display work, out of scope here.
- **Track**: a note that track/course detection is automatic — no track
  picker forced up front, since `courseDetection.ts` already does this
  post-hoc and requiring it earlier would be a step backward.

**Classification, not a new capture path.** `FileMetadata.sessionType?: "simple"
| "drag" | "track"` (new field). `RecordingModeDialog` doesn't touch any
capture flow — `LoggerDownload` and everything under it (RaceBoxLiveRecord,
DragyLiveRecord, PhoneGpsRecord, the hardware downloads) are unchanged and
still own their own `saveFileMetadata` calls. The dialog only wraps
`onDataLoaded`: once a flow reports a finished session, `updateFileMetadata`
(existing read-merge-write helper) stamps `sessionType` on top, so it can
never clobber what the capture flow already wrote.

## Related, deliberately not done here

- **Issue #58** (filed while scoping this): a rider wants to record a VESC
  alongside a primary GPS device at the same time. No live VESC transport
  exists (only the post-ride `.csv` import), and true concurrent multi-source
  capture is a comparable-sized undertaking to the existing RaceBox/Dragy BLE
  work — tracked separately rather than folded in here.
- The "improved display" issue #43 actually asks for — surfacing drag metrics
  for a `sessionType: 'drag'` session, lap metrics for `'track'` — is future
  work this classification enables, not part of it.

## Verified

`bun run lint`/`typecheck`/`test:run` (2546 tests)/`build` all pass. Clicked
through the full flow in a live browser check: mode picker → drag-mode setup
(warning text renders) → device step (both `DevicesTile`/`ThisDeviceTile`
render side by side, Back navigates correctly between all three steps).
