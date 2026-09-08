# 0023 — Detecting and being honest about GPS recording gaps

**Status:** done (part 1 of 2 — see "Deliberately not done here")
**Date:** 2026-09-07

## Problem

A rider recorded a real, multi-mile phone-GPS session and reviewed it afterward:
the map showed a single straight line between two points, and the speed/altitude
chart showed a straight linear decay across the whole session distance. Pulling
the actual saved `.dovep` file out of the browser's IndexedDB (via `adb` + Chrome
DevTools Protocol against the live device) confirmed the session genuinely only
contained 2 GPS fixes, timestamped 2.9 seconds apart — everything rendered was
real data, but the map was drawing a straight line across a large real-world gap
as if it were a traveled path.

## Root cause

Traced the full write path (`lapTimerSession.ts` → `dovepWriter.ts` →
`fileStorage.ts` → IndexedDB → `dovexParser.ts` on reload) and found no code that
truncates, resets, or drops samples — every fix that reaches `CustomGps`'s
`watchPosition` callback gets appended to an unbounded buffer and persisted
verbatim. The gap is upstream of all of that: **Android Chrome stops delivering
`watchPosition` callbacks once the tab loses the foreground or the screen
sleeps.** A plain web page has no API to keep receiving location updates through
that — unlike a native app with a foreground service, a PWA's `watchPosition` is
tied to page visibility. Confirmed by the rider's own account: the ride was real
and multi-mile, but the two logged fixes only correspond to whatever brief
window the screen/tab happened to be active.

This isn't fixable in JS — see "Deliberately not done here" for the mitigation
that actually addresses it (a screen-lock overlay, tracked as a follow-up).
**This plan is the honest-reporting half**: since the app can't prevent the gap,
it should stop drawing a fake path across one.

## What changed

**`lib/gpsGaps.ts`** (new, pure): `detectGpsGaps(samples, thresholdMs = 15_000)`
finds every pair of consecutive samples further apart in time than the
threshold — 15s is far above any real source's cadence (phone GPS ~1 Hz,
RaceBox/Dragy/hardware loggers all faster), so a genuine gap is unambiguous.
Also `totalGapMs()` and `formatGapDuration()` for the banner copy. Any source
can gap (a dropped BLE connection, a GNSS dropout), so this isn't phone-GPS
specific.

**`lib/speedHeatmap.ts`**: `buildHeatmapSegments()` takes an optional
`hardBreakBeforeIndex: ReadonlySet<number>`. Unlike a bucket-color change (which
shares a point so the line stays visually continuous), a hard break does not
connect sample i-1 to sample i at all — no line is drawn across a gap. A run
left with only one point (two hard breaks back to back, or a break right before
the last sample) is dropped rather than rendered as a stray dot.

**`components/RaceLineView.tsx`**: feeds `detectGpsGaps(samples)` into the
polyline-drawing effect as the hard-break set (`samples` is the currently-drawn,
possibly-cropped range, so the break indices line up with what's actually
rendered), and shows a top-center banner — "GPS gap detected — 5m 12s of this
session wasn't recorded" — computed from the *full* session
(`allSamples ?? samples`) regardless of the crop/range slider, so cropping the
view to hide a gap doesn't also hide the warning.

**`components/PhoneGpsRecord.tsx`**: the "About phone GPS accuracy" dialog (shown
once per browser, before the first phone-GPS recording) now also says plainly
that locking the phone or switching apps pauses recording, and not to press the
power button when putting the phone away.

## Verified

- New tests: `gpsGaps.test.ts` (12 cases, including the exact 2-fixes/2.9s-apart
  shape from the real bug report, confirmed to correctly stay undetected as a
  "gap" — that's a GPS jump, not a recording dropout, a separate concern from
  `parserUtils.isTeleportation`), plus 4 new `speedHeatmap.test.ts` cases for
  `hardBreakBeforeIndex`. `bun run lint`/`typecheck`/`test:run` (2,610
  tests)/`build` all pass.
- Reproduced the bug end-to-end in the running app: wrote a synthetic `.dovep`
  (two GPS clusters ~5m12s apart) directly into IndexedDB, opened it, and
  confirmed the banner reads "GPS gap detected — 5m 12s of this session wasn't
  recorded" and the map draws two disconnected polyline segments instead of a
  line spanning the gap. Cleaned up the synthetic data afterward.

## Deliberately not done here

- **The chart still draws a straight interpolated line across a gap.** This
  pass focused on the map, which is what actually misled the rider (a fabricated
  route on a satellite map reads as much more convincing than a chart's linear
  interpolation). Worth the same `hardBreakBeforeIndex`-style treatment in
  `TelemetryChart`/`SingleSeriesChart` as a follow-up.
- **A screen-lock overlay to prevent the gap in the first place.** `useWakeLock`
  already runs for the whole phone-GPS recording (`LapTimerTool`'s
  `useWakeLock(phase !== "ended")`), which keeps the screen from auto-sleeping
  from inactivity — but the Wake Lock API explicitly cannot override a
  deliberate power-button press, by spec. The next step (tracked separately,
  not built here) is a full-screen "recording — locked" overlay, similar to
  Waze/workout-app patterns: blocks accidental taps while the phone rides in a
  pocket with the screen lit, with an intentional unlock gesture to reach Stop.
  Wake lock + lock overlay together cover the "phone untouched in a pocket"
  failure mode, which is the common case; a deliberate power-button press or
  app-switch is still outside what a web page can prevent.
