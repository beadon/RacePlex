# 0034 — Live BLE heart-rate sidecar (issue #87)

**Status:** done

## Problem

Issue #79/#87's RaceChrono comparison work flagged a real gap: no live
heart-rate capture, only heart rate already recorded into an imported
`.FIT` file. Unlike VESC/BMS, this data isn't board-specific — it's about
the rider, works with equipment most riders may already own (a chest strap
or a smart watch), and has an openly documented Bluetooth SIG standard
(`0x180D` Heart Rate Service) rather than needing protocol
reverse-engineering.

## What changed

A fourth live BLE sidecar, mirroring the VESC/BMS pattern exactly:

- `lib/live/heartRateDecoder.ts` — decodes the standard Heart Rate
  Measurement characteristic (`0x2A37`): BPM (u8 or u16 per the flags byte),
  the most recent RR-interval when present (beat-to-beat variability, useful
  for HRV analysis), and sensor-contact status.
- `lib/live/heartRateTransport.ts` — connects and subscribes. Filters
  `requestDevice()` on the Heart Rate Service UUID itself rather than
  `acceptAllDevices` (which VESC/BMS are stuck with for lack of a
  distinguishing service) — already narrows the picker to compatible
  devices without needing a name.
- `lib/live/heartRateDevicePreference.ts` — remembers the last-connected
  device's name in localStorage (not a Vehicle field — a heart-rate monitor
  belongs to the rider, not the board, so it's deliberately excluded from
  `useSidecarVehicleBinding.ts`/plan 0030's Garage binding). On a repeat
  connection, that name narrows the `requestDevice()` filter further — the
  closest real equivalent Web Bluetooth allows to "put it at the top of the
  list," since nothing can reorder or replace the browser's own picker UI.
- `lib/live/heartRateMergeFields.ts` — folds a merged reading into
  `extraFields`. The BPM channel is named "Heart Rate" to match
  `fitParser.ts`'s existing label for the same data read out of an imported
  `.FIT` file, so a live capture and an imported ride look identical in the
  chart.
- `hooks/useHeartRateSidecar.ts` + `components/HeartRateSidecarControl.tsx` —
  same connect/status/disconnect pattern as `useVescSidecar`/
  `useBmsSidecar`, including the plan-0031 fix (cancelling the picker goes
  back to idle, not an error) built in from the start rather than
  discovered live a fourth time.
- Wired into all three sidecar-capable surfaces — `RaceBoxLiveRecord`,
  `DragyLiveRecord`, the phone-GPS Lap Timer — alongside VESC/BMS: same
  `ConcurrentSourceMerger`, same `.rplx`/`.rplive` format decision (a
  heart-rate-only session now also gets `.rplive`), same "capture continues
  while parked" behavior (plan 0029's follow-up), same `hasHeartRateData`
  session-row chip (plan 0032) via a new `FileMetadata` field.

## Recording session UI (issue follow-up, same PR)

Also addressed directly in the Lap Timer tool while this was fresh:

- A running session-duration readout in the header, derived from the GPS
  observation's own elapsed clock (not a wall-clock interval, so it can't
  drift from what's actually being recorded) — anchored the moment the
  session arms.
- The heart-rate sidecar control's icon now pulses while receiving data —
  the "small heartbeat icon" asked for.
- `RecordingLockOverlay` (plan 0025's lock screen) gained the same duration
  readout, a live BPM display with the same pulsing heart icon, and the
  VESC/BMS/heart-rate chips (the same `SidecarDataChips` component plan
  0032 built for session rows, reused here for *live* status instead of
  saved-metadata status) — so a rider can see at a glance, without
  unlocking, that everything is still recording.

## Files

- New: `lib/live/heartRateDecoder.ts` (+test), `heartRateTransport.ts`,
  `heartRateMergeFields.ts` (+test), `heartRateDevicePreference.ts` (+test),
  `hooks/useHeartRateSidecar.ts`, `components/HeartRateSidecarControl.tsx`.
- Modified: `lapTimerSession.ts` (+test), `useLapTimer.ts`, `LapTimerTool.tsx`,
  `RecordingLockOverlay.tsx`, `RaceBoxLiveRecord.tsx`, `DragyLiveRecord.tsx`,
  `lib/fileStorage.ts`, `lib/fileBrowserTree.ts` (+test),
  `components/SidecarDataChips.tsx`.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2685 tests) /
`bun run build` all green. Not yet verified against real heart-rate
hardware — no such device available in this pass; the transport/decoder
follow the openly published Bluetooth SIG spec byte-for-byte rather than a
reverse-engineered protocol, which is a meaningfully different risk profile
than the BMS work, but "the spec matches" is not the same claim as "a real
strap was connected," per this repo's own Golden Rule 3b.
