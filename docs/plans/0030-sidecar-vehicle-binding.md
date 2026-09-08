# 0030 — Remember a paired VESC/BMS device on a Vehicle profile

**Status:** done

## Problem

`RaceBoxLiveRecord`, `DragyLiveRecord`, and the phone-GPS Lap Timer tool (plan
0029) can all pair a VESC and/or JBD BMS sidecar over Web Bluetooth, but every
connection starts from zero — the rider re-scans and re-picks the same
physical device out of the browser's Bluetooth chooser every single session.

## What changed

The first time a connected VESC or BMS sidecar reports real telemetry (not
just a successful BLE handshake), its BLE-advertised device name gets
remembered on a Vehicle ("board") profile in the Garage:

- No vehicles exist yet → a new one is created, seeded with that device name.
- Exactly one vehicle exists → the device name attaches to it (a VESC and a
  BMS paired in either order, same or different sessions, both land on the
  same vehicle rather than creating two).
- More than one vehicle exists → nothing happens. Guessing which of several
  boards a sidecar belongs to risks silently mislabeling the wrong one; a
  rider with multiple boards can still set this by hand in the Garage.

This is deliberately conservative — it only acts in the two unambiguous
cases. `planSidecarVehicleBinding` (`lib/live/sidecarVehicleBinding.ts`) is
the pure decision function; `useSidecarVehicleBinding.ts` is the thin React
hook wiring it to `useVescSidecar`/`useBmsSidecar` + `useVehicleManager`,
shared by all three sidecar-capable surfaces so the behavior is identical
regardless of which primary GPS source started the capture.

`Vehicle` gains two new optional fields, `vescDeviceName?`/`bmsDeviceName?`,
following the existing free-form-string convention `batteryBmsMake`/`Model`
already use (there's no shared "catalog" of VESC/BMS models the way
`remotes` is a catalog for remote controllers — device names have no fixed
convention, per `vescTransport.ts`'s own comment on this).

## Not in this pass

Saving the name doesn't yet change how the next connection attempt works —
`connectVescLive()`/`connectBmsLive()` still show every nearby device in the
picker. Using the remembered name to pre-filter that picker (VESC already
supports an optional `namePrefix`; BMS's transport would need the same
option added) is real follow-on scope of its own, tracked separately rather
than folded into this change.

## Files

- `src/lib/vehicleStorage.ts` — `Vehicle.vescDeviceName?`/`bmsDeviceName?`.
- `src/lib/live/sidecarVehicleBinding.ts` (+ test) — pure binding decision.
- `src/hooks/useSidecarVehicleBinding.ts` — React wiring + a `sonner` toast
  confirming what got saved.
- `src/plugins/tools/laptimer/useLapTimer.ts`, `src/components/RaceBoxLiveRecord.tsx`,
  `src/components/DragyLiveRecord.tsx` — each call the hook alongside their
  existing `useVescSidecar`/`useBmsSidecar` calls.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2659 tests) /
`bun run build` all green.
