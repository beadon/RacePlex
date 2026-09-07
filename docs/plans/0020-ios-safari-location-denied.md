# 0020 — iOS Safari: guide the rider when location is denied

**Status:** done
**Date:** 2026-09-07

## Problem

Found testing with a real iPhone (issue #60): when a rider has denied Safari
location access, the Lap Timer tool just shows the DOM's generic "Location
permission was denied" message. There is no way to re-request or reset the OS
permission from a web page — the only recovery is the rider's own Settings
app — so the least the app can do is tell them exactly where to go.

## Design

`lib/gps/customGps.ts` already normalizes a geolocation failure into a
`GpsErrorCode` (`'permission-denied'` for DOM code 1), but `LapTimerSession`
only forwarded the raw message string, not the code, so the UI had no way to
distinguish "denied" from "no fix yet" or "timed out."

- `LapTimerSnapshot.errorCode: GpsErrorCode | null` (new) — set from
  `gps.onError`, explicitly cleared to `null` on a save error (a save failure
  is unrelated to GPS permission and shouldn't trigger the iOS-specific copy).
- `lib/iosSafari.ts` (new): `isIosSafari()`. Two things worth getting right —
  iPadOS reports a Macintosh UA unless "Request Desktop Website" is off, so
  `maxTouchPoints > 1` disambiguates a touch iPad from a real Mac; and every
  other iOS browser (Chrome, Firefox, Edge) embeds WebKit and "Safari" in its
  UA too, so excluding their own tokens (`CriOS`/`FxiOS`/`EdgiOS`/`OPiOS`) is
  required to not misfire on them.
- `LapTimerTool.tsx`: when `errorCode === 'permission-denied'` **and**
  `isIosSafari()`, render step-by-step re-enable instructions instead of the
  generic banner — Settings → Privacy & Security → Location Services → Safari
  Websites, plus the faster in-Safari "AA" menu → Website Settings → Location
  path. Every other browser or error code keeps the plain message; these
  specific steps don't apply anywhere else.

New copy lives in the Tools plugin's own locale bundle
(`plugins/tools/locales/en.json`, `laptimer.iosLocationDenied.*`) — English
only, per the i18n policy (best-effort translations, never gate on them).

## Verified

`bun run lint`/`typecheck`/`test:run` (2547 tests)/`build` all pass. New unit
tests for `isIosSafari()` (Safari vs. Chrome/Firefox on iOS, iPad vs. real
Mac, Android) and for `LapTimerSession` forwarding `errorCode` (both the GPS
and save-error paths). The UI branch itself isn't unit-tested — `LapTimerTool.tsx`
is view-layer, outside this repo's coverage scope — verified by code
inspection of the prop wiring instead.
