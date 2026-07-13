# 0013 — Portable data export: get your data out, from any build

**Status:** in progress
**Date:** 2026-07-13

## Problem

RacePlex records sessions and stores everything in the browser — IndexedDB and
localStorage. That data is a rider's own work: sessions, vehicles, setups, notes,
custom tracks, lap snapshots, remembered CSV column mappings. Today there is no
way for most users to get it back out.

An export *does* exist — `downloadAccountExport()` in the **cloud-sync plugin** —
but it has two problems.

**It is unreachable on a stock build.** The button lives in `DataPrivacyPanel`,
contributed to the `Profile` panel slot by the cloud-sync plugin. RacePlex ships
with `VITE_ENABLE_CLOUD=false` and no backend (see CLAUDE.md — the fork blanks
every Supabase credential). The one surface that lets a rider retrieve their own
data is gated behind the one feature this fork deliberately doesn't ship. The
export function also calls `supabase.functions.invoke("export-account-data")`
unconditionally before it gathers anything local.

**It is incomplete.** `gatherLocal()` walks `DOC_STORES` — the *sync* list — so
anything that doesn't cloud-sync isn't exported. Missing:

| Data | Where | Why it matters |
|---|---|---|
| `lap-snapshots` | IDB | frozen course-fastest laps, the rider's benchmarks |
| `remotes` | IDB | the remote catalog (plan 0010) |
| `weather-cache` | IDB | session weather, immutable once looked up |
| `video-sync` | IDB | video↔session sync offsets — re-deriving these is manual work |
| `session-videos` | IDB | the video blobs themselves |
| `users` | IDB | local user profiles (plan 0011) |
| `raceplex-plugin-*` | IDB (per-plugin KV) | Stance + Seat Position tool state |
| `raceplex-csv-mappings-v1` | localStorage | remembered CSV column mappings — real user work, and the thing that makes an unknown CSV importable at all |
| `racing-datalog-submitted-v1` | localStorage | which tracks were submitted |
| `phoneGps:precisionWarningAck`, `device_name`, … | localStorage | small prefs |

A rider who moves browsers loses all of the above even if they run the export.

## Decision

Export is a **core** capability, not a cloud feature. Rule 1 (offline-first) and
Rule 8 (this is released OSS) both point the same way: the app holds the user's
data, so the app owes them a way to take it.

### Layering

```
src/lib/dataExport.ts      (core, pure-ish I/O)   collectLocalData() → LocalData
src/lib/exportManifest.ts  (core, PURE)           buildManifest(local, cloud?) → paths
src/lib/dataImport.ts      (core)                 importArchive(zip) → summary
src/lib/dataStores.ts      (core, PURE)           the inventory: every store + LS key
        ↑                                                  ↑
        │ composes                                         │ reuses
src/plugins/cloud-sync/accountExport.ts           adds the cloud/* half
```

The cloud plugin keeps ownership of the cloud half and *composes* the core local
export. No duplication, and the GDPR flow inherits the wider coverage.

**`dataStores.ts` is the single inventory.** One list of IDB stores, one list of
localStorage keys, one list of plugin ids. A new store added to `dbUtils.ts`
without adding it here is the failure mode that produced this plan, so the
inventory ships with a test that asserts it covers every `STORE_NAMES` entry —
add a store, the test fails until you classify it (export it, or explicitly mark
it excluded with a reason).

### Videos are opt-in

`session-videos` holds multi-gigabyte blobs. A single unconditional button that
silently produces a 4 GB ZIP reads as a hang. The export dialog shows the
measured size of the video blobs and offers them behind a checkbox, default off.
Everything else is always included (all of it is small).

### Surfaces

One component, `src/components/DataExportSection.tsx`, mounted in three places:

1. **Settings modal** — a "Your data" section. Reachable from every page; where
   users look for data controls. This is the primary surface.
2. **Tools tab** — a `ToolDef` in `plugins/tools/toolList.ts`, so it sits with
   the other rider-facing utilities.
3. **Files drawer** — next to the existing single-file `exportFile()`, where the
   data visibly lives.

`DataPrivacyPanel` (cloud) keeps its own button — that one is the GDPR
cloud+local export and stays.

## Round-trip guarantee

Import must restore what export writes, or the export is a museum piece. Both
sides read the same `dataStores.ts` inventory and the archive layout is
symmetric, so a test can assert: seed → export → wipe → import → identical.
That test is the actual deliverable here; the button is the easy part.

## Verification

Golden Rule 3b — green tests don't mean it works. After building:
run the app, seed a session, export, check the ZIP has the files, wipe the
origin, import, confirm the session/garage/tracks come back.
