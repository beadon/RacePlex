# 0031 — Cancelling the Bluetooth picker shouldn't look like a failure

**Status:** done

## Problem

Reported live in the phone-GPS Lap Timer's recording screen: clicking "+ Add
VESC" and then cancelling the browser's Bluetooth device picker made the
button disappear — `useVescSidecar`'s `connect()` caught the rejection from
`navigator.bluetooth.requestDevice()` and set `status: "error"`, so
`VescSidecarControl` swapped to its error view (a destructive-colored message
plus troubleshooting text about closing VESC Tool) instead of just going back
to the plain "+ Add VESC" button. The troubleshooting text is actively wrong
guidance for a rider who simply changed their mind or picked the wrong item —
there is no fault to troubleshoot.

## What changed

`lib/live/bleUtils.ts` gains `isUserCancelledBluetoothPicker(err)`, checking
for the `NotFoundError` DOMException Chrome's `requestDevice()` rejects with
on cancel. `useVescSidecar`/`useBmsSidecar`'s `connect()`, and the primary
connect handlers in `RaceBoxLiveRecord`/`DragyLiveRecord`, all check this
before falling into the generic error path — on a cancel, status/phase goes
back to `"idle"` with no error set, same as before the rider ever clicked
connect, ready to try again immediately.

Applied to all four connect sites (two sidecar hooks + two primary transports)
rather than just the one reported, since they share the exact same bug:
Web Bluetooth's cancel rejection looks identical everywhere it's used.

## Files

- `src/lib/live/bleUtils.ts` (+ test) — new `isUserCancelledBluetoothPicker`.
- `src/hooks/useVescSidecar.ts`, `src/hooks/useBmsSidecar.ts` — sidecar connect.
- `src/components/RaceBoxLiveRecord.tsx`, `src/components/DragyLiveRecord.tsx`
  — primary device connect.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2664 tests) /
`bun run build` all green.
