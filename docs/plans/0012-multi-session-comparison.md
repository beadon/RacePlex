# 0012 — Multi-session comparison

## Goal

A rider often wants to compare two or more separate sessions side-by-side.
The existing single-session tools cover overlay-within-one-file (via
`useLapOverlays`) — this is the *cross-file* case:

- Same rider, different runs — "is that new tune actually faster?"
- Multiple riders on one track — "who's carrying more speed through turn 3?"
- Group ride debrief — "everyone's power/speed/VESC state at the same corner."

This is the last feature-request on the tracker (#37).

## Constraints

- **Offline-first.** No server hop; every session is already in IndexedDB.
- **Doesn't hijack the single-session flow.** Opening one session must stay a
  single click. Comparison is a separate mode, entered explicitly.
- **Reuses the parsing + normalization the app already runs.** Every parser
  puts channels through `normalizeChannels()`, so two sessions from different
  loggers share canonical ids without special-casing.
- **Distance-first alignment.** Comparing two runs of different length by
  clock time is meaningless — riders think in "where on the track". The
  existing lap-overlay code (`lib/lapOverlays.ts`) already re-samples by
  arc-length distance; that's the pattern to reuse.
- **English-only for now.** New surfaces get hardcoded English strings.

## The scope split

The issue outlines two layouts:
1. **Stacked charts, aligned x-axis** — same channel across all sessions,
   one panel per channel. Best for "why is A faster than B in this corner".
2. **Small multiples grid** — one tile per session (map + speed + stats).
   Best for "who did what on the group ride".

This plan ships **stacked charts first**. Small multiples is a natural
follow-up — same session data, different layout — and can land in a
subsequent slice without changing the plumbing.

Also **not** in this plan:
- Cross-rider leaderboards (already covered by plan 0005 with server-side
  ranking).
- Cloud-shared comparisons (uses local IndexedDB only; if the rider has
  cloud sync on, they already have the files locally).

## Model

### Selection UX

`RecentSessionsTile` grows a small "Compare" affordance — a checkbox per
row that stages files into a "comparison bin". A floating action bar
appears when ≥1 file is selected: "Compare N sessions" (enabled at ≥2).
The bin lives in local component state on the dashboard, not persisted —
it's a workflow, not a saved query.

The file-manager drawer (Garage → Files) gets the same affordance so the
full list is reachable, but the dashboard tile is the primary path.

### The route

New route: `/compare`. Reads the selected file names from
`location.state.compareFileNames` (React Router passes state through
`navigate`), falls back to redirecting to `/` if the state isn't there
(a bare `/compare` URL is meaningless).

`ComparisonView` fetches every selected file's blob, runs them through
`parseDatalogFile` (each becomes a `ParsedData` with normalized channels
and detected laps), and hands the result set to the layout components.

Sessions load in parallel. The view shows a per-session progress row
during load — some sessions may parse in a tick, others (XRK, GoPro) take
seconds — so a "Loading N/M sessions" progress bar is worthwhile.

### Alignment

Every session has its own arbitrary length. Alignment options:

- **By distance from lap start** (default). Uses the same arc-length
  resample as `lapOverlays`. Each session's selected lap (the fastest by
  default; a lap picker per session lets you compare specific laps)
  becomes one array of samples indexed by "% of the way around the
  track". Chart x-axis = 0..1 or 0..distance-of-longest-lap.
- **By elapsed time from lap start**. Simpler but only meaningful when the
  laps started at the same physical point.
- **By clock time** (whole session). Only useful for group rides where
  everyone was recording concurrently. Requires a `startDate` on both
  sessions (most parsers set one).

Default: distance-from-lap-start on the fastest lap of each session. The
user can change alignment mode and lap picks in a top bar.

### Chart shape

Stacked charts, one channel per row, N series per chart (one per
session). Colours pulled from an ordered palette so session A is
consistent across every channel. The existing `TelemetryChart` /
`SingleSeriesChart` components already handle multi-series lap overlays —
extending them to multi-session series is a small change:
`useLapOverlays` today wraps `series: [{ lapNumber, samples, color, label }]`;
the new comparison flow builds the same shape from `series: [{ fileName,
samples, color, label }]`. Same chart, different provenance for each
series.

Which channels appear:
- Speed and delta always.
- Every optional channel gets a checkbox in the top bar; ones checked-on
  by default = the union of the app's default enabled channels across
  every loaded session.

### What sits above the charts

A **top bar** with:
- One row per loaded session: colour swatch, name, lap picker (defaults
  to fastest), remove ("×") button.
- Alignment mode select.
- Channel toggles.
- "Add session" button that reopens the picker.

A **map** at the top, showing every session's selected lap overlaid on
the shared course. Same colour as its chart series.

## Approach — slices

Each slice = one commit citing plan 0012.

1. **Selection bin plumbing.** New hook `useComparisonBin` — an in-memory
   Set of file names, with add/remove/clear + a subscribe callback. No
   persistence; the dashboard mounts it.
2. **RecentSessionsTile multi-select UX.** Per-row checkbox +
   floating action bar. Tapping a row still opens the session solo (the
   checkbox is a separate hit target); pressing "Compare" navigates to
   `/compare` with the bin.
3. **`/compare` route + `ComparisonView`.** Fetches + parses selected
   files in parallel, shows a progress bar, renders a shell with the top
   bar (session rows, alignment mode) and an empty chart area.
4. **Alignment + first chart.** Compute per-session speed vs. distance
   arrays from each session's fastest lap. Render a `SingleSeriesChart`
   with multiple series. This proves the alignment.
5. **Channel toggles + additional charts.** Union the field mappings
   across sessions; the top bar exposes toggles; each enabled channel
   gets its own chart panel.
6. **Shared map overlay.** Draw each session's selected lap on one
   Leaflet map with session-coloured polylines.
7. **File-manager drawer parity.** Same checkbox affordance in the
   drawer's Files tab so the dashboard isn't the only path in.

Stops here. Small-multiples layout, per-session stats table, video sync,
and delta-vs-delta charts are all natural follow-ups — plan will get
updated at that point.

## Touch points

- `src/hooks/useComparisonBin.ts` — new.
- `src/components/dashboard/RecentSessionsTile.tsx` — per-row checkbox,
  floating action bar.
- `src/pages/Compare.tsx` — new route.
- `src/App.tsx` — register `/compare`.
- `src/lib/comparison/` — new directory for the pure alignment and
  series-building logic. Kept apart from the React view so vitest can
  hammer on it without React.
- `src/components/comparison/*` — the top bar, chart stack, map overlay.
- `src/components/drawer/FilesTab.tsx` — parity with the dashboard.

## Testing

- `useComparisonBin`: add/remove/clear/dedup — pure hook, no React needed.
- `lib/comparison/align.ts`: arc-length resample, "fastest lap of each
  session", edge cases (a session with zero laps → row skipped, session
  with one sample → series is empty not corrupt).
- `lib/comparison/series.ts`: unioning field mappings across sessions,
  colour assignment stability.
- Manual: full flow in-app (issue #37).

## Rejected alternatives

- **Global comparison bin in localStorage / IndexedDB.** Overkill — the
  bin is a workflow, not a saved query. If a rider wants to save a
  comparison, they screenshot it. If demand emerges we can add saved
  comparisons as its own row in IDB.
- **Reuse Index.tsx with a `compareFiles` param.** Would collapse two
  distinct modes (single vs multi) onto one page, complicating every
  hook that assumes a single session. A dedicated route is simpler.
- **New chart from scratch.** The existing Canvas chart already handles
  multi-series lap overlays; the "series" abstraction is already there.
  Extending is far cheaper than a rewrite.

## Status

- **Landed end-to-end.** All 7 slices from the approach section shipped:
  1. Selection bin (`useComparisonBin` + 8 tests)
  2. RecentSessionsTile multi-select + action bar
  3. `/compare` route + parallel session load with per-file progress
  4. Distance-normalised alignment + `ComparisonChart` (10 tests)
  5. Channel-toggle bar
  6. Shared Leaflet map — one polyline per session's selected lap, coloured
     to match its chart series
  7. File-manager drawer parity — same checkbox affordance in the Files tab
- **Not done, still queued (small-multiples + polish):**
  - Small-multiples layout (one tile per session with map+chart+stats)
  - Per-session stats table (min/avg/max speed, delta to fastest)
  - Video-sync across sessions
  - Cross-session delta lap-time chart (all sessions vs. the fastest)
  - Lift the SVG chart onto the app's Canvas `TelemetryChart` so a shared
    playback cursor + crosshair works across sessions — the "series"
    abstraction already exists on that chart, just needs wiring.
