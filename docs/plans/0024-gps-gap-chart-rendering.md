# 0024 — Extend GPS gap detection to the analysis charts

**Status:** done
**Date:** 2026-09-07

## Problem

[[0023-gps-recording-gap-detection]] stopped the map from drawing a straight
line across a GPS recording gap, but the Simple-mode telemetry chart and the
Pro-mode graph panels still interpolated a straight line across the same gap
— the map fix's own before/after screenshot showed this clearly (the chart at
the bottom of the session view kept the old behavior). Same underlying bug,
different renderer.

## What changed

**`lib/chartUtils.ts`**: `buildSeriesPoints()` — already had a `SeriesPoint.gap`
mechanism that breaks the drawn line at null/undefined/NaN values — takes an
optional `hardBreakBeforeIndex: ReadonlySet<number>` (same shape as
`speedHeatmap.ts`'s parameter from 0023). A GPS gap forces the same `gap: true`
treatment even though the value at that index is perfectly valid — the problem
is a gap in *time*, not in the value, so it wouldn't otherwise trip the
null/NaN check. Both the 1:1 pass-through path and the decimated (per-pixel
min/max) path handle it.

**`components/TelemetryChart.tsx`** and **`components/graphview/SingleSeriesChart.tsx`**:
both compute `detectGpsGaps(samples)` → a `Set` of `afterIndex` values, and pass
it into every `buildSeriesPoints()` call that draws *this session's own* series
(the main speed line, extra-field lines, and `SingleSeriesChart`'s single
series). Reference-lap and multi-lap-overlay series come from a different
sample array with its own index space — gap indices computed against `samples`
wouldn't line up with them, so those calls are left as they were. Extending gap
detection to a reference/overlay session's own data is a separate concern.

## Verified

- New tests: 4 cases in `chartUtils.test.ts` for `hardBreakBeforeIndex`
  (1:1 mode, combined with an existing null-driven gap, decimated-mode
  propagation, and no-breaks-given produces identical output to before).
  `bun run lint`/`typecheck`/`test:run` (2,614 tests)/`build` all pass.
- Reproduced in the running app with the same synthetic gapped `.dovep` used to
  verify 0023's map fix: the Simple-mode chart's Speed/Altitude/H Accuracy
  lines all correctly stop at the sample before the gap and resume after it,
  with no interpolated line spanning the ~5-minute void. Cleaned up the test
  data afterward.

## Deliberately not done here

- Reference-lap and overlay-lap series (their own sample arrays) don't get gap
  detection in this pass — only the current session's own lines.
