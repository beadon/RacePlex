# 0033 — Cap the telemetry chart legend so the map stays visible

**Status:** done

## Problem

Reported live on a phone with a VESC + BMS sidecar session (issues #58,
#73): opening the session in the Simple map view left almost no room for the
map. `TelemetryChart.tsx`'s legend renders one row per `FieldMapping`
regardless of `enabled` state, wrapping (`flex-wrap`) into as many rows as
needed with no cap — a VESC+BMS session can carry close to 20 channels
(`vescMergeFields.ts` + `bmsMergeFields.ts`, each appending a mapping for
every channel that appeared in the data, whether or not it defaults to
`enabled: true`). On a phone-height viewport, that legend can grow tall
enough to push the chart canvas below it down to almost nothing, and since
`RaceLineTab.tsx`'s map/chart split holds a fixed ratio, the map's own space
was untouched but genuinely felt "impossible to view" per the report —
confirmed the actual complaint was the *chart* tab's legend, verified with
the bundled VESC sample session at a narrow viewport before and after.

## What changed

The legend's container gained `max-h-24 overflow-y-auto`. Every channel is
still listed and still togglable (each row is also the chart's series-enable
button — nothing was hidden or removed), but the legend now scrolls within
its own bounded box past three-ish rows instead of growing without limit.
Verified live: with the VESC sample session at a 616×615 viewport, the map
area is now fully visible and the legend scrolls to reveal channels past
"Motor Temp (C) / ESC Temp (C) / Battery Level / Fault Code" (Pitch, GPS
Accuracy, etc. below the fold) instead of pushing the canvas off-screen.

A short session with only 1-2 channels sees no visible change — the box
sizes to its content up to the cap, so this doesn't need viewport detection
(none exists in the codebase yet) and behaves identically on desktop and
phone.

## Files

- `src/components/TelemetryChart.tsx` — legend container className.

## Verification

`bun run typecheck` / `bun run lint` all green (no test file exists for this
component — it's excluded from coverage scope, view-layer only). Verified
live via `bun run dev` + a narrow browser viewport against the bundled VESC
Tool sample session, before and after the change.
