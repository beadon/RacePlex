# 0022 — VESC RT gauge dashboard (issue #58 follow-up)

**Status:** done
**Date:** 2026-09-07

## Problem

A rider connecting a VESC sidecar during live recording ([[0021-vesc-concurrent-capture]])
only ever sees two numbers in the connection chip (battery current/voltage).
VESC Tool's own "RT Data" screen shows a full dashboard of round gauges the
rider already knows how to read — current, power, duty, speed, battery,
temps, consumption, and odometer/trip/up-time. The ask, in the user's own
words: *"there is a very nice view of the data collected from VESC that we
should mimic in RacePlex … we need to show this same RT display."* — and,
clarifying the visual requirement: *"not the different colors, and meters
that go around these round gauges, with visual 'pointers' … that indicate
the current values."* The tick-mark ring and needle carry the reading; color
is decoration, never the only encoding.

## What changed

**`vescDecoder.ts`**: added `decodeGetValuesSetup()` for VESC's
`COMM_GET_VALUES_SETUP` (command id 47) — a strict superset of the plain
`COMM_GET_VALUES` this app already decoded, adding firmware-computed speed,
battery percentage, trip/odometer distance, and watt-hours. Field order and
scale factors came from VESC Tool's own client parser
(`vesc_tool/commands.cpp`), not the bare-firmware `comm/commands.c` handler —
that description turned out to match an older/shorter revision of this
response and didn't account for all 70 bytes of a real capture. Verified
byte-for-byte against a real capture from a "BKB XENITH BLE" board: every
decoded field matched what VESC Tool showed on screen for that exact board
at that exact moment, including the odometer (decoded 780.93 mi vs. "780.9"
shown).

Decoding stays tolerant past `battery_level`: every later field individually
checks the payload is long enough before reading it, so a board running
older firmware that omits trailing fields (amp-hours, trip, fault code,
vesc count, odometer, uptime) still yields a partial, honest reading instead
of failing outright. This matters because the board this was tested against
self-reports as needing a firmware upgrade — as the user put it, *"as the
VESC protocol evolves we will need to keep pace somewhat as more boards and
versions are added."*

**`vescTransport.ts`**: switched the poll from `COMM_GET_VALUES` to
`COMM_GET_VALUES_SETUP` — same 100ms interval, same NUS connection, but the
richer response. `useVescSidecar`'s `latest` is now typed `VescSetupValues`
throughout (`RaceBoxLiveRecord.tsx`/`DragyLiveRecord.tsx`'s
`ConcurrentSourceMerger` generic parameter updated to match).
`vescMergeFields.ts` (the file-recording merge path) was left alone — it
only reads the `VescValues` subset of fields, which `VescSetupValues`
structurally satisfies, so recorded-session channels are unaffected.

**`components/vesc-gauges/CircularGauge.tsx`**: a reusable round gauge — a
270° tick ring (major ticks labeled, minor ticks between), a thin needle
pointer pivoting from a radius short of center (so it never crosses the
center readout, unlike a naive center-pivoted wedge tried first), and a
center label/value/unit stack. Pure SVG so it scales responsively
(`className="w-full h-auto"` overrides the fixed presentation-attribute
size) and repaints cheaply on every 100ms poll tick — no canvas, no library.

**`components/vesc-gauges/VescGaugeDashboard.tsx`**: assembles eleven
readings into the same layout VESC Tool uses — CURRENT/POWER/DUTY,
SPEED/BATTERY, TEMP ESC/CONSUMP/TEMP MOTOR, then ODOMETER/TRIP/UP-TIME as
plain stat boxes. Power and Wh/mi (or Wh/km) are derived
(`batteryCurrentA × batteryVoltageV`, `wattHours ÷ tripDistance`) since VESC
doesn't hand over a power reading directly. Speed and distance respect the
app's existing unit toggles (`useKph`, `useMetricDistance`) via
`lib/units.ts` rather than hardcoding MPH/miles the way VESC Tool does.

Gauge ranges (current ±, power, duty, speed) are fixed defaults, not read
from the board's own configured limits — `COMM_GET_VALUES_SETUP` doesn't
carry them, and reading `COMM_GET_MCCONF` just to scale a dial isn't worth
the extra request/response round trip for a first pass. A reading past the
printed range still displays correctly; the needle pins at the end stop.

**Wiring**: `VescSidecarControl`'s connected-state chip is now clickable,
opening the dashboard in a `Dialog`. The compact "42 A · 45 V" text stays as
the at-a-glance summary; the full gauge view is opt-in so it doesn't compete
with the primary GPS recording UI during a run.

## Verified

- All 12 `vescDecoder.test.ts` cases pass, including the real-hardware
  golden fixture (see below for a bug found and fixed in that fixture, not
  the decoder).
- Rendered `VescGaugeDashboard` in the browser (light and dark) via a
  temporary preview route, screenshotted, and confirmed: tick rings render
  correctly, needles point at the right position, no needle/text overlap,
  labels legible at the dashboard's actual card width. The temporary route
  was removed before committing — it isn't part of the shipped app.
- `bun run lint`, `bun run typecheck`, `bun run test:run` (2,594 tests),
  and `bun run build` all pass.

### A transcription bug, not a decoder bug

The first version of `vescDecoder.test.ts`'s `REAL_CAPTURE` fixture was
missing one byte (a `0x00` dropped while hand-transcribing the hex capture
into a `Uint8Array` literal), shifting every field after it by one position
and producing a plausible-looking but wrong `faultCode` of 109. Re-deriving
the payload programmatically from the original CRC-verified hex string and
diffing it against the fixture byte-for-byte found the exact missing byte.
The decoder's field offsets were correct throughout — worth recording
because the failure mode (a subtly wrong constant that still looks like
real hardware data) is exactly the kind of thing that's easy to misdiagnose
as a protocol misunderstanding instead of a fixture typo.

## Deliberately not done here

- No board-reported current/speed/power limits — gauge ranges are fixed
  defaults (see above).
- `COMM_GET_VALUES_SETUP_SELECTIVE` (a bitmask-gated subset variant in newer
  firmware) isn't used — the plain command already returns everything this
  dashboard needs on the boards tested.
- No historical/sparkline view — this is the live instantaneous reading
  only, matching VESC Tool's own RT Data screen.
