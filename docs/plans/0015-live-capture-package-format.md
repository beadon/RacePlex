# 0015 — `.rplive`: a live capture that can actually be reopened

**Status:** done
**Date:** 2026-09-07

## Problem

Found while building the data-issue diagnostic tool (plan 0014) and tracing why a
rider's recorded session might not display: `RaceBoxLiveRecord.tsx` and
`DragyLiveRecord.tsx` (live BLE capture, plan-adjacent to `src/lib/live/`) each
saved their finished session as raw `{samples, startDate}` JSON under a made-up
extension — `.raceboxjson`, `.dragyjson`. Neither extension was ever registered
in `datalogParser.ts`. The comment in `RaceBoxLiveRecord.tsx` said as much: *"the
app doesn't parse `.raceboxjson` on reopen yet — future slice."*

The rider sees their session fine immediately after recording (the in-memory
`ParsedData` is handed to the viewer directly), and the file lands in the file
manager so a refresh doesn't lose it — but reopening that saved file later (Files
drawer, or an app reload that re-lists it) hits no matching parser and fails.
Before this plan the failure was also silent (`console.error` only, see plan
0014's `FilesTab.tsx` fixes) — the exact "I have data, it's just not displaying"
symptom.

The phone-GPS capture path (`lib/gps/dovepWriter.ts`) already avoided this by
piggybacking on the existing `.dovex` schema — the gap was BLE-only.

## Design

- **`.rplive`** — one small versioned JSON envelope
  (`src/lib/live/liveCapturePackage.ts`) shared by every live-capture source:
  `{ formatVersion, source: { kind: 'racebox' | 'dragy' | 'phone', deviceName? },
  samples, fieldMappings, startDate? }`. `formatVersion` exists so a future field
  can be added or reinterpreted without breaking already-saved sessions.
- **Extension-gated, not content-sniffed.** No real device or export tool
  produces a `.rplive` file, so `isLiveCaptureFormat()` just checks the
  extension — no risk of colliding with the ordering-sensitive text-format table
  in `datalogParser.ts` (CLAUDE.md Golden Rule 3b). Registered in the async
  route only, same precedent as XRK/GoPro/FIT (extension needs a filename, which
  the sync `parseDatalogContent` entry point never has).
- **Filename encodes what the rider asked for**: source and when.
  `buildLiveCaptureFileName()` produces
  `<kind>[-slugified-device-name]-YYYYMMDD_HHMMSS.rplive` — e.g.
  `racebox-racebox-micro-12ab-20260107_140322.rplive`. The BLE device name comes
  from `RaceBoxConnection.name`/`DragyConnection.name` (whatever the device
  advertised), captured before `teardown()` clears the connection ref.
- **`RaceBoxLiveRecord.tsx` / `DragyLiveRecord.tsx`** now call
  `serializeLiveCapture()`/`buildLiveCaptureFileName()` instead of hand-rolling
  JSON — this is the only change to either component; the capture/session logic
  is untouched.

## Not done here

- No migration for already-saved `.raceboxjson`/`.dragyjson` files — this is
  pre-release, so there's nothing in the wild to migrate. If that stops being
  true, `FilesTab.tsx`'s new error toasts (plan 0014) at least surface the
  failure instead of hiding it.
