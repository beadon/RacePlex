# 0028 — Fix a bug affecting every live BLE connection: RaceBox, Dragy, VESC, BMS

**Status:** done, verified against real hardware
**Date:** 2026-09-08

## Problem

Plan 0027 built a temporary route exercising the real, shipped
`connectBmsLive()` against a real BMS — the first time any `lib/live/`
transport's actual connect code (not a standalone diagnostic replica) had
been run end-to-end against real hardware. It failed immediately:

```
device.gatt.addEventListener is not a function
```

## Root cause

Per the Web Bluetooth spec, `gattserverdisconnected` fires on the
`BluetoothDevice` object itself — `BluetoothRemoteGATTServer` (`.gatt`) has
no `addEventListener` at all. Every live BLE transport in this codebase —
`raceboxTransport.ts`, `dragyTransport.ts`, `vescTransport.ts`, and the BMS
transport just added in plan 0027 (copied from `vescTransport.ts`) — called
`device.gatt.addEventListener("gattserverdisconnected", ...)`, which throws
the instant a real connection is attempted.

**This has been broken in every merged live-capture PR since plan 0021 at
the latest** (VESC concurrent capture) and likely since the original
RaceBox/Dragy live capture (#32) — every one of those PRs' "verified against
real hardware" claims verified the *protocol* (packet framing, decode logic)
via a standalone diagnostic HTML page with its own hand-rolled connection
code, never the actual shipped `connectRaceBoxLive()`/`connectDragyLive()`/
`connectVescLive()` functions themselves. The bug was invisible to every
prior real-hardware test because none of them exercised this exact line.

A second, related bug surfaced testing the fix: `disconnect()` awaits
`notifyChar.stopNotifications()` before reaching `device.gatt?.disconnect()`.
On the same real BMS, that call took over 90 seconds to settle on one
occasion — confirmed via `adb shell dumpsys bluetooth_manager` still showing
an active Chrome GATT connection to the device the whole time. A `disconnect()`
flow must never let one BLE operation's response time gate the rest of
teardown.

## What changed

- **`lib/live/bleUtils.ts`** (new): `withTimeout()`, a small `Promise.race`
  helper — shared by all four transports rather than duplicated four times,
  since it's genuinely the same fix in each.
- **`raceboxTransport.ts`, `dragyTransport.ts`, `vescTransport.ts`,
  `bmsTransport.ts`**: moved `addEventListener` off the `gatt` object onto
  the device object itself (both in the TypeScript `BleDevice`-shaped type
  and the actual call site), and wrapped each `stopNotifications()` call in
  `withTimeout(..., 2000)` so a slow-to-respond peripheral can't block the
  actual `device.gatt?.disconnect()` from running.

## Verified against real hardware

Using the same real JBD BMS from plan 0027, with the actual shipped
`connectBmsLive()` (not a diagnostic replica):

- **Before the fix**: connect failed immediately with the `addEventListener`
  error above.
- **After the fix**: connected successfully, received live decoded samples
  (voltage/current/SOC/temps/cell voltages, all correct), then disconnected
  in **~250ms** — confirmed via `adb shell dumpsys bluetooth_manager` that
  Chrome's GATT connection to the device was actually released, not just
  that the UI moved on.
- RaceBox/Dragy weren't re-tested against real hardware in this pass (no
  RaceBox/Dragy device available), but the fix is the same three-line change
  applied identically to all four files, and the root cause (a spec fact
  about where an event fires, not device-specific behavior) applies equally
  to all of them.

## Why this matters beyond the immediate fix

This is the sharpest illustration yet of this repo's own Golden Rule 3b
("green tests do not mean it works — RUN THE APP"), extended one level
further: **verifying a protocol's bytes are correct doesn't mean the
connection code that delivers those bytes actually works.** A standalone
diagnostic page proved the wire format; it never proved `connectVescLive()`
itself could complete a real connection. The gap between "the protocol is
right" and "the shipped function that uses it works" is exactly where this
bug lived, undetected, through several "verified against real hardware"
plan writeups.
