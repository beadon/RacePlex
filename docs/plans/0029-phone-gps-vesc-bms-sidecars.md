# 0029 — VESC/BMS sidecars for phone-GPS recording (issues #58, #73)

**Status:** done

## Problem

`RaceBoxLiveRecord`/`DragyLiveRecord` (plans 0021, 0027) already let a rider
pair a VESC and a JBD BMS alongside a RaceBox or Dragy over Web Bluetooth. The
phone-GPS Lap Timer tool (`LapTimerSession`/`useLapTimer`) had no such path —
a rider without a RaceBox or Dragy had no way to record ESC or BMS channels
at all, even though the phone's own GPS is a perfectly usable primary source.

## What changed

`LapTimerSession` now accepts the same optional `vescMerger`/`bmsMerger`
(`ConcurrentSourceMerger`, from `lib/live/concurrentCapture.ts`) the RaceBox/
Dragy flows use. Every accepted GPS fix is paired against whichever sidecars
are connected and the merged VESC/BMS channels land in that sample's
`extraFields` — same `applyVescMergeToExtraFields`/`applyBmsMergeToExtraFields`
functions, so a live-merged channel looks identical whether the primary was a
RaceBox or a phone.

`useLapTimer` owns the sidecar connections (`useVescSidecar`/`useBmsSidecar`)
and their mergers, and `LapTimerTool.tsx` renders the same
`VescSidecarControl`/`BmsSidecarControl` "+ Add VESC" / "+ Add BMS" buttons
RaceBoxLiveRecord uses, visible any time the session isn't ended.

**Output format**: a plain phone-GPS session (no sidecar ever reported data)
still writes the standard `.rplx` log, unchanged. A session where a VESC or
BMS reported at least one sample instead writes `.rplive` — `.rplx`'s CSV
schema is fixed (`timestamp,lat,lng,speed_mph,altitude_m,heading_deg,h_acc_m`)
with no room for extra channels, while `.rplive` carries arbitrary
`GpsSample.extraFields` + `FieldMapping[]`. `LiveCaptureSourceKind` already
had a `'phone'` variant defined and unused before this — it was built for
exactly this case.

`hasSidecarData` is decided from `ConcurrentSourceMerger.hasSecondary`, which
stays true for the rest of the session once a sidecar has ever reported a
sample, even if that sidecar later disconnects — a session shouldn't silently
drop back to `.rplx` (and drop everything already recorded from a sidecar)
just because the BLE link died partway through a run.

## Files

- `src/plugins/tools/laptimer/lapTimerSession.ts` — `LapTimerSessionDeps` gains
  optional `vescMerger`/`bmsMerger`; `handleFix` merges into a `GpsSample`
  buffer kept alongside the existing `GpsObservation` buffer; `persist`
  branches on `hasSidecarData` to choose `.rplx` vs `.rplive`.
- `src/plugins/tools/laptimer/useLapTimer.ts` — owns the two
  `ConcurrentSourceMerger` instances + `useVescSidecar`/`useBmsSidecar`,
  passes the mergers into `LapTimerSession`, tears sidecars down on unmount.
- `src/plugins/tools/laptimer/LapTimerTool.tsx` — renders
  `VescSidecarControl`/`BmsSidecarControl` below the header.
- `src/plugins/tools/laptimer/lapTimerSession.test.ts` — new coverage: a
  plain session still writes `.rplx`; a VESC-only, BMS-only, and both-sidecars
  session each write `.rplive` with the expected channels merged into the
  last sample.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2651 tests) /
`bun run build` all green. Not yet re-verified against real VESC/BMS hardware
in this pass — the merge/persist logic is identical to the already
hardware-verified RaceBoxLiveRecord path (plans 0021, 0027), reused rather
than reimplemented.

## Follow-up: record sidecar data while parked

Reported immediately after the above merged: a rider bench-testing a VESC or
watching a BMS charge doesn't move, so GPS lap timing never arms — and the
original `handleFix` only pushed a fix into `recorded`/`samples` while
`gate.phase === "recording"`, so a stationary sidecar session recorded
nothing at all.

Fixed by decoupling sidecar capture from the movement gate: `handleFix` now
captures a fix whenever `gate.phase === "recording"` **or** a sidecar has
ever reported data (`vescMerger?.hasSecondary || bmsMerger?.hasSecondary`).
Lap timing itself (`timer.update`, lap-list updates) still only runs while
actually `"recording"` — only the sidecar-driven capture ignores the
movement gate. A plain GPS-only session (no sidecar) is unaffected: it still
only starts recording once armed, exactly as before. Confirmed safe against
the auto-idle timer too — `stepSessionGate` never auto-ends from `"waiting"`,
only from `"recording"` after having been armed and then stopped, so a
sidecar-only parked session can't be cut short by that timeout.
