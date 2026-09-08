# 0021 — Recording a VESC alongside a primary GPS device (issue #58)

**Status:** done, verified against real hardware
**Date:** 2026-09-07

## Problem

Issue #58: while recording with a primary GPS device (RaceBox, Dragy, or the
phone), a rider should be able to also connect a VESC-based ESC live and
have its telemetry (motor current, battery voltage/current, duty cycle,
ERPM, temperatures) merged into the same session — not a separate post-ride
CSV import (`vescCsvParser.ts`, which already does this for a *file*, at
whatever rate each channel happened to be logged at).

The follow-up ask, in the user's own words: *"the time it was received is
the best timestamp, but could be slightly delayed by a few ms depending on
bluetooth/network conditions, so suspect areas of the data should be noted
as suspect if that occurs (silent errors lead to the user trusting the data
logger less)."* That sentence is the actual design constraint this plan is
built around.

## What existed before this

Nothing. `src/lib/live/` had RaceBox and Dragy transports/decoders; no VESC
transport, no concept of two live sources at once — every live-record
component (`RaceBoxLiveRecord.tsx`, `DragyLiveRecord.tsx`, `PhoneGpsRecord.tsx`)
assumed exactly one BLE connection for the life of a capture.

## Design

**The VESC wire protocol is real, documented, and open-source** — not
reverse-engineered guesswork the way Dragy's was. VESC's own firmware
(`vedderb/bldc`) and its official nRF52 BLE UART bridge (`vedderb/nrf52_vesc`)
define it:

- `lib/live/vescPacket.ts` — packet framing (`start | length | payload |
  crc16 | stop`) and a `VescPacketReader` ring buffer, same resync discipline
  as `UbxRingBuffer` (drop a byte, try again, never trust a notification
  boundary as a packet boundary). CRC is XMODEM-parameterized (poly `0x1021`,
  init `0`) — confirmed against firmware source and the standard conformance
  vector for "123456789" (`0x31C3`), not assumed from the "CCITT-FALSE" label
  a first pass at the docs used, which has a different init value.
- `lib/live/vescDecoder.ts` — `COMM_GET_VALUES` request/response. Field order
  and scale factors are copied from `comm/commands.c`'s own
  `buffer_append_float16/32` call sequence. Only decodes through the fields
  RacePlex's file-based VESC import already surfaces (temps, currents, duty,
  ERPM, voltage, amp-hours, fault code) — later fields (PID position,
  Vd/Vq, per-firmware-version extras) are on the wire but unread, so this
  only needs firmware old enough to have *this* front section, which has
  been stable across VESC firmware history.
- `lib/live/vescTransport.ts` — Web Bluetooth NUS connection, mirroring
  `raceboxTransport.ts`. Unlike RaceBox/Dragy, VESC doesn't push — nothing
  arrives until asked, so this polls `COMM_GET_VALUES` every 100ms. No fixed
  BLE name convention exists for VESC boards (unlike "RaceBox"/"Dragy"), so
  the picker shows every nearby device rather than filtering by name prefix.

**The actual sync design** — `lib/live/concurrentCapture.ts`,
`ConcurrentSourceMerger`: merges by **receipt time** (`Date.now()` at the
moment each device's own BLE notification fires), explicitly not either
device's onboard clock — neither RaceBox/Dragy's clock nor VESC's (which has
none at all for this) are synced to each other or the phone. Every primary
sample pairs with the most recently received secondary sample; a pairing
older (or, less commonly, newer — a same-tick ordering anomaly) than
`maxAgeMs` (default 250ms) is flagged `suspect: true` rather than presented
as clean. `secondary: null` (no VESC data received yet) and `suspect: true`
(stale VESC data received) are deliberately different states — "no data" and
"bad data" read differently to a rider.

`lib/live/vescMergeFields.ts` folds a merged reading into a `GpsSample`'s
`extraFields`, using the exact same channel labels `vescCsvParser.ts` uses
("Motor Current (A)", "Battery Voltage (V)", …) so a live-merged channel and
a file-imported one look identical in the chart, plus a `VESC Sync Suspect`
channel (1/absent) that rides along with the data rather than being buried
in a log only a developer would see.

**UI**: `useVescSidecar` (hook) + `VescSidecarControl` (a "+ Add VESC"
button, shown once the primary capture is recording) — wired into both
`RaceBoxLiveRecord.tsx` and `DragyLiveRecord.tsx` identically. `PhoneGpsRecord`
was left out of this pass (lower-value pairing, and its UI is a different,
simpler shape not well suited to a second pairing without more redesign).

## Verified against real hardware

Confirmed live against a real board (a "BKB XENITH BLE" VESC-based ESC),
using a standalone diagnostic page (not the app itself — a minimal page that
connects, enumerates GATT, and sends a raw `COMM_GET_VALUES` request) driven
from an Android phone over Web Bluetooth:

- The device advertises exactly the assumed Nordic UART Service
  (`6e400001-…`) with write/notify characteristics at `6e400002`/`6e400003`
  — the protocol guess from VESC's public firmware source was right, not
  just plausible.
- A real `COMM_GET_VALUES` response decoded byte-for-byte with this plan's
  actual `vescPacket.ts`/`vescDecoder.ts` code: CRC16 matched, framing
  matched, and the decoded values were physically sensible for an idle,
  disconnected controller — battery voltage 45.4V (stable across repeated
  reads), motor/battery current, duty cycle, ERPM, amp-hours all 0, ESC temp
  ~30.5°C. Motor temp read a nonsense ~‑84°C, which is *correct* decoder
  behavior — a floating/disconnected motor-thermistor pin reading garbage is
  expected real hardware behavior, not a bug to paper over.
- One real connection failure was reproduced and understood: a VESC's BLE
  UART typically accepts only one central connection at a time, so a
  simultaneously-connected VESC Tool session blocks a fresh connection with a
  generic "Connection attempt failed." `VescSidecarControl`'s error state
  now says this plainly rather than leaving a rider stuck retrying a
  connection that can't succeed while that's true.

Not yet done: recording an actual live session with a spinning motor (only
idle/disconnected values have been observed so far), and testing the
concurrent-merge path (`concurrentCapture.ts`) with real timing alongside a
real RaceBox/Dragy simultaneously.

## Deliberately not done here

- `PhoneGpsRecord.tsx` doesn't get a VESC sidecar in this pass.
- No UI surfaces the *rate* of suspect flagging yet (e.g. "12% of this
  session's VESC data was stale") — the flag is in the data; summarizing it
  is a follow-up.
