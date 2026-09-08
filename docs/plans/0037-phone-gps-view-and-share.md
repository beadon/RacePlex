# 0037 — Phone GPS: view and share a just-recorded session

**Status:** done

## Problem

When a phone-GPS recording session ended, the only action offered was "New
session" — there was no way to actually look at the ride just recorded, or
hand it to someone else. The rider had to close the recorder, find the file
in the file browser, and open it separately. There was also no way to share
a session file to another person (email, text, WhatsApp, Telegram) so they
could open it in RacePlex on a bigger screen.

## What changed

- `LapTimerSession.persist()` now keeps the parsed `ParsedData` on the
  snapshot as `savedData`, alongside the existing `savedBlob`, instead of
  only writing to IndexedDB. Neither is handed to the host automatically.
- `LapTimerTool`'s "ended" screen gained two buttons next to "New session":
  - **View session** — calls `props.onSessionSaved?.(savedData, savedFileName)`
    then `props.onClose?.()`, handing the already-parsed data straight to
    `Index.tsx`'s session state without a round-trip through IndexedDB.
  - **Share** — calls the new `shareOrDownloadSession()`, which opens the OS
    share sheet (Web Share API with a file attachment) pre-filled with a
    message pointing the recipient at https://beadon.github.io/RacePlex/ to
    import and view the ride, falling back to a plain download on a browser
    that can't share files.
- `PhoneGpsRecord` and `LoggerDownload` now thread `onDataLoaded` through to
  `LapTimerTool`'s `onSessionSaved` — the one missing line that had made
  phone-GPS recording the only capture flow that couldn't hand its result to
  the main viewer at all.

### The unmount bug

The first version of this wired `onSessionSaved` (then still named
`onDataLoaded`) to fire automatically the moment `persist()` finished saving,
mirroring `RaceBoxLiveRecord`'s pattern. Live testing (geolocation mocked via
injected `navigator.geolocation.watchPosition`, driven through the real
record → end-session flow) showed the "ended" screen never appeared at all —
`Index.tsx` renders `Dashboard` (and everything under it, `LoggerDownload` →
`PhoneGpsRecord` → `LapTimerTool` included) only while `data` is `null`, so
the same render that set `data` unmounted the recorder before the screen
could be seen or clicked. `savedData` fixed this by only ever handing off on
an explicit "View session" click — the screen with both buttons now stays up
until the rider chooses.

## Files

- `src/plugins/tools/laptimer/lapTimerSession.ts` — `savedData` on the
  snapshot.
- `src/plugins/tools/laptimer/LapTimerTool.tsx` — View session / Share
  buttons, `onSessionSaved`/`onClose` props.
- `src/lib/shareSession.ts` (new) — `shareOrDownloadSession()`.
- `src/components/PhoneGpsRecord.tsx`, `src/components/LoggerDownload.tsx` —
  thread `onDataLoaded` through.
- `src/plugins/tools/locales/en.json` — `laptimer.savedHint` copy update.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2693 tests) /
`bun run build` all green. Verified live via `bun run dev` with mocked
geolocation: recorded a session, ended it, confirmed the "ended" screen
persists with both "View session" and "Share" visible, "Share" completes
without error, and "View session" loads the ride into the main viewer (map +
chart render, "No Track Detected" prompt appears as expected for an
unrecognized route).
