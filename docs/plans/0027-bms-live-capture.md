# 0027 — Record a JBD BMS alongside GPS + VESC (issue #73)

**Status:** done (protocol + wiring; UI verified as a component preview, not a full live-hardware session — see below)
**Date:** 2026-09-08

## Problem

Riders using a VESC-based board also have a BMS (battery management system)
managing the pack, and want its telemetry — voltage, current, per-cell
voltages, temperatures — recorded live alongside GPS and VESC data, as a
third concurrent source. See issue #73.

## Real hardware identified and verified

A rider's board uses a **JBD (Jiabaida)** BMS, sold under names like
"Xiaoxiang" / "Smart BMS" / "Little Elephant" (the vendor app's package name,
`com.jiabaida.little_elephant`, found via `adb shell dumpsys
bluetooth_manager` while genuinely connected). Unlike VESC, this protocol
isn't vendor-published, but it's widely community-reverse-engineered — and
this plan verified it byte-for-byte against the real unit rather than trusting
docs alone, using a standalone diagnostic HTML page (same technique as
plan 0021's VESC verification) driven over `adb reverse` + Chrome DevTools
Protocol against the rider's actual phone.

Confirmed live, with every value cross-checked against the vendor app's own
RT Data screen for the same board at the same moment:

- GATT service `0000ff00-...`, notify `0000ff01-...`, write `0000ff02-...`.
- Frame format `0xDD | ... | 0x77`, request and response checksums computed
  **differently** (request sums `cmd+len+data`; response sums `len+data`
  only, excluding the echoed cmd/status byte — confirmed, not assumed, by
  computing both against a real capture and checking which one matches).
- `COMM_BASIC_INFO` (0x03): voltage, current, capacity, cycle count, SOC%,
  charge/discharge FET status, cell count, and per-sensor temperatures.
- `COMM_CELL_VOLTAGES` (0x04): per-cell voltage array.
- `COMM_DEVICE_NAME` (0x05): an ASCII identity string (`SP17S005P17S20A`) —
  see the identity caveat below.
- **Temp sensor index 0 is the MOSFET/board sensor** — confirmed because the
  vendor app explicitly labels one reading "MOS" and it matches sensor 0's
  value exactly. This is a firmware/vendor convention, not guaranteed across
  every JBD-family board, but true on the one tested.
- Derived stats the vendor app computes client-side rather than reading as
  raw fields: Power = V×A, and VolHigh/VolLow/VolDiff/AveVol from the cell
  array — `bmsDecoder.ts`'s `BmsCellVoltages` computes the same four.

**Identity is not as simple as the device name.** Walking the vendor app's
"Basic Information" screen found the Bluetooth name / Device model string
(`SP17S005P17S20A`) is almost certainly a **model/batch code**, not a
guaranteed per-unit serial — the Bar code and BMS ID fields that are meant to
be unique were both blank/unprogrammed on the tested unit. This matters for
the follow-up pack-history work (issue #74) but not for this plan's live
telemetry, which doesn't need a stable identity to function.

**Safety scope, documented on issue #74 (applies here too)**: RacePlex is
strictly read-only against this BMS. The vendor app's Origin Setting
(capacity/cell-count calibration) and Control (charge/discharge FET toggles,
AutoBalance, ClearWarning, Reset capacity) screens are all writes to
safety-relevant hardware and are never exposed by RacePlex, in any form, at
any confirmation level.

## What changed

Mirrors the VESC concurrent-capture architecture (plan 0021/0022) file-for-file:

- **`lib/live/bmsPacket.ts`** — frame/checksum logic + `BmsPacketReader`
  (resync-on-garbage ring buffer, same discipline as `VescPacketReader`).
- **`lib/live/bmsDecoder.ts`** — `decodeBasicInfo`/`decodeCellVoltages`/
  `decodeDeviceName`, tolerant of a truncated payload (returns null rather
  than guessing) and of trailing temperature sensors being cut short.
- **`lib/live/bmsTransport.ts`** — Web Bluetooth connection; alternates
  `COMM_BASIC_INFO`/`COMM_CELL_VOLTAGES` requests every 1s (half that rate
  each, individually) rather than doubling the poll rate, since BMS data
  doesn't need GPS-rate updates. No name-prefix filter, same reasoning as
  VESC: no fixed BLE naming convention across JBD-family boards.
- **`lib/live/bmsMergeFields.ts`** — folds a merged reading into
  `GpsSample.extraFields`: Pack Voltage/Current/SOC/Cycles (enabled by
  default), MOSFET Temp/Cell High/Cell Low/Cell Avg/Protection (disabled by
  default, matching VESC's "detail channels start off" convention).
- **`hooks/useBmsSidecar.ts`** + **`components/BmsSidecarControl.tsx`** —
  connection lifecycle hook and "+ Add BMS" UI control, structurally
  identical to `useVescSidecar`/`VescSidecarControl`. The error state
  includes the same "only one app connects at a time" hint VESC's does —
  confirmed necessary in practice: the vendor app reconnected to the BMS in
  the background during this session even after being disconnected via
  Android's own Bluetooth settings, not just when reopened.
- **`RaceBoxLiveRecord.tsx`/`DragyLiveRecord.tsx`**: a third BLE source.
  `ConcurrentSourceMerger` stays a two-party (primary+secondary) design — a
  second, independent merger instance (primary+BMS) runs alongside the
  existing one (primary+VESC), both folding into the same sample's
  `extraFields` object, rather than generalizing the merger to more than one
  secondary.

## Verified

- `bmsPacket.test.ts` (8 cases) and `bmsDecoder.test.ts` (10 cases) use the
  real captured bytes as golden fixtures — not synthetic data — including a
  frame reassembled across three simulated BLE-notification chunks the way
  the real device actually delivered it. `bmsMergeFields.test.ts` (10 cases)
  covers the extraFields folding logic.
- `bun run lint`/`typecheck`/`test:run` (2,647 tests)/`build` all pass.
- `BmsSidecarControl` verified visually in the running app via a temporary
  component-preview route (all four states: idle, connecting, error,
  connected) — removed before committing.

**Not verified**: an actual end-to-end live BLE session through
`RaceBoxLiveRecord`/`DragyLiveRecord` with a real BMS connected (the rider
disconnected their phone before this wiring layer was written). The
transport code (`bmsTransport.ts`) is structurally identical to the
already-verified `vescTransport.ts` and its request/response decode path is
covered by hardware-verified unit tests, but the live BLE plumbing itself
(GATT connect, notification delivery through the real characteristic) has
not been exercised against the real board. Worth a real-hardware pass before
calling this fully done, same standard plan 0021 held VESC to.

## Deliberately not done here

- No gauge dashboard (VESC got one in a follow-up plan, 0022, after its
  sidecar shipped) — `BmsSidecarControl`'s compact status line only, matching
  how VESC started.
- No pack-identity/lifetime-history work (issue #74) — a different kind of
  problem (persistent storage, not a `lib/live/` transport) tracked
  separately.
- No Vehicle/Garage binding (auto-recognizing "this is Board X's BMS") — also
  tracked on issue #74 as a follow-up once manual connection is solid.
