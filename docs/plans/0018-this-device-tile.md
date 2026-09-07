# 0018 — Promote phone GPS to a top-level "Add data" option

**Status:** done
**Date:** 2026-09-07

## Problem

Most riders will try RacePlex with their phone's own GPS before ever buying a
Bluetooth logger — it's the zero-cost way to see if lap timing works for their
spot. That path was buried: Dashboard's "Add data" section had two tiles,
**Devices** and **Import**, and phone GPS was the *last row* inside the
Devices picker dialog, sitting below RaceBox, Dragy, MyChron, and Alfano —
visually no different from a piece of hardware the rider doesn't own.

Full write-up: issue #54.

## Design

Three top-level tiles instead of two:

1. **This device** (new, `ThisDeviceTile.tsx`) — starts phone-GPS recording
   directly; no picker dialog in between. Shows the phone's model when the
   browser can report it (`lib/deviceInfo.ts`: `navigator.userAgentData
   .getHighEntropyValues(['model'])`, Chromium/Android only — Safari/iOS and
   Firefox lack `userAgentData` entirely and fall back to a generic label, no
   guessing).
2. **External Device** (renamed from "Devices," `DevicesTile.tsx`) — the same
   picker, minus the phone-GPS row.
3. **Import** — unchanged.

`LoggerDownload` already owned the lazily-mounted `PhoneGpsRecord` and its
`phoneGpsActive` state for the picker's phone row, so exposing it as a second,
independent trigger (`renderPhoneTrigger`) alongside the existing picker
trigger (`renderTrigger`) reused that state directly rather than duplicating
it. `LoggerPicker` gained an opt-in `hidePhoneGps` — **opt-in**, not a
behavior change for its other two callers (Files drawer, Garage→Device tab),
which keep the phone-GPS row exactly as before. Promoting it there too, if
wanted, is a follow-up (noted as out of scope in issue #54) — those are
secondary surfaces, and dropping phone-GPS from them with no replacement
would have been a regression nobody asked for.

## Verified

`bun run lint`/`typecheck`/`test:run` (2546 tests)/`build` all pass. Clicked
through both tiles in a live browser check: "This device" opens the phone-GPS
precision-warning dialog directly with no picker in between; "External
Device" shows the same 5 hardware loggers with no phone-GPS row.
