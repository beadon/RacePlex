# 0026 — Rename the phone-GPS log extension to `.rplx`

**Status:** done
**Date:** 2026-09-07

## Problem

The phone-as-datalogger tool wrote sessions as `.dovep` ("Dove phone") —
Dove/DovesDataLogger is upstream's project this app forked from, and RacePlex
riders never see or use anything called "Dove." Per the user: *"since we are
diverging, setting an extension we own, `.rplx`, will go a long way in
reducing confusion."*

## What changed

Straight rename, no content-format change (the on-disk bytes are unchanged —
still the Dove-CSV-compatible content `dovexParser.ts` already reads):

- `lib/gps/dovepWriter.ts` → `lib/gps/rplxWriter.ts`. Every exported
  identifier renamed to match: `DOVEP_EXTENSION` → `RPLX_EXTENSION` (value
  `'rplx'`), `DovepSessionMeta` → `RplxSessionMeta`, `formatDovepDatetime` →
  `formatRplxDatetime`, `buildDovepFileName` → `buildRplxFileName`,
  `serializeDovep`/`serializeDovepBlob` → `serializeRplx`/`serializeRplxBlob`.
  A partial rename (new extension, old function names) would have left a
  confusing "why does `serializeDovep` write `.rplx` files" trail for the next
  reader, so this went all the way through.
- `lapTimerSession.ts`, `LapTimerTool.tsx`, `PhoneGpsRecord.tsx`, `gps/index.ts`:
  updated imports and doc comments.
- `logFileType.ts`: kept the `dovep` extension mapping (now labeled "Phone" —
  was "Dovep") for already-saved legacy files, and added `rplx` → "Phone" for
  new ones. Both extensions show the same badge since the content is identical.
- `docs/subsystems.md` and `CLAUDE.md`: updated the `.dovex`/`.dovep` section
  header and references to `.dovex`/`.rplx`, with a note that `.dovep` is the
  pre-rename legacy name.

## Why no migration

Format detection (`isDovexFormat` in `datalogParser.ts`) is **content-based**,
not extension-based — it never looks at the file name. So a `.dovep` file
already sitting in a rider's browser keeps opening exactly as before, forever,
with zero code changes required. This rename only changes what *new*
recordings are named going forward. Renaming already-saved files in place
(touching their IndexedDB keys) would be a needless, mildly risky operation
for a purely cosmetic naming problem — not done.

## Naming note

`.rplive` already exists (plan 0015) as RacePlex's branded extension for the
live-capture package format (RaceBox/Dragy BLE sessions — a JSON envelope,
extension-gated rather than content-sniffed). `.rplx` and `.rplive` are
visually similar at a glance; they're unrelated formats (different content,
different parsers, different UI surfaces) that happen to share the `.rp`
prefix. Flagged for awareness — not changed, since the user asked for `.rplx`
specifically.

## Verified

- `bun run lint`/`typecheck`/`test:run` (2,610 tests)/`build` all pass.
- Updated `rplxWriter.test.ts` (renamed from `dovepWriter.test.ts`) and
  `logFileType.test.ts` (added coverage for both `.rplx` and legacy `.dovep`
  mapping to the same "Phone" label).
- Exercised the real recording flow in the running app (stubbed
  `navigator.geolocation.watchPosition`): started a phone-GPS session, ended
  it, and confirmed the "Session saved" screen showed a filename ending in
  `.rplx` (e.g. `20260907_1923.rplx`), not `.dovep`.

## Deliberately not done here

- No migration of already-saved `.dovep` files — see above.
- Didn't touch `.rplive` naming, despite the visual-similarity note.
