# 0017 — PWA upgrades were producing a white screen

**Status:** done
**Date:** 2026-09-07

## Problem

Riders upgrading the installed PWA reported a blank/white screen. Reproduced
live on a real device (Pixel 8 Pro, RacePlex installed as an Android WebAPK)
via `adb forward tcp:9222 localabstract:chrome_devtools_remote` + the Chrome
DevTools Protocol: `document.getElementById('root')` was empty — React never
mounted — and reloading surfaced the real cause in `Log.entryAdded` events:

```
Failed to load resource: 404 — assets/ReportDataIssueDialog-hKPlmQ6H.js
Failed to load resource: 404 — assets/fileSources-D5dZhTaX.js
Failed to load resource: 404 — assets/i18n-BsjT8nK2.js
Failed to load resource: 404 — assets/buildInfo-Dm23NQlG.js
```

The device was running an `index.html` (or a service-worker generation) whose
chunk graph referenced hashed filenames from a deploy several versions back.
GitHub Pages replaces the entire `dist/` on every deploy — it doesn't keep old
hashed assets around — so once the client's view of "current" and the server's
actual current diverge, every lazy-loaded chunk 404s and the app never mounts.
A manual reload recovered it (confirmed live), which narrows the cause to a
transient staleness rather than a permanently broken deploy — exactly what an
uncoordinated service-worker update produces.

## Root cause: `registerType: "autoUpdate"` + `skipWaiting: true` together

`vite.config.ts`'s `VitePWA()` block had `registerType: "autoUpdate"` and
Workbox's `skipWaiting: true` — both dated to the original scaffolding commit
(`1a8ecfd8`, `gpt-engineer-app[bot]`), the same commit that *also* added
`main.tsx`'s `onNeedRefresh` callback and "Update ready" toast (`showUpdateToast`
/ `rebootToLatest`). Tracing `vite-plugin-pwa`'s actual registration template
(`dist/client/build/register.js`) shows these don't compose:

- `registerType: "autoUpdate"` makes the client register the `auto` branch,
  which listens for `"activated"` and calls `window.location.reload()`
  **immediately**, unconditionally, the moment a new worker activates. It never
  wires up `onNeedRefresh` — that whole toast/prompt code path only exists in
  the *else* (`"prompt"`) branch. It has been dead code since the day it was
  added.
- Workbox's `skipWaiting: true` bakes `self.skipWaiting()` into the generated
  service worker's own `install` handler, so the new worker activates on its
  own, without waiting for a client to ask — before a page has any chance to
  observe a `"waiting"` state or show a prompt.

Combined with `clientsClaim: true`, the result is: a new deploy goes live, the
next background `registration.update()` check (or the periodic 60s poll, or
simply reopening a long-dormant installed PWA) finds it, the worker
self-activates, claims every open client, and force-reloads them — all with no
warning, no coordination with whatever the page is doing, and (for a PWA that
missed several deploys while closed) potentially several of these cycles
racing at once. A `NetworkFirst` navigation fetch with only a 3-second timeout
sits in the middle of that; on a real device's real network, that's enough to
occasionally resolve against a stale HTML/precache combination whose chunk
references the live server no longer has.

## Fix

- `registerType: "prompt"`, `skipWaiting: false` (Workbox's own default) in
  `vite.config.ts`. This is the officially documented pairing for the
  "prompt to update" pattern — a new worker now waits until the rider clicks
  "Refresh" on the toast, which sends it the skip-waiting message itself; only
  then does it activate, `clientsClaim` still applying so every open tab
  updates together from that one deliberate click. This makes the
  already-written `main.tsx` update-toast code path finally reachable — no
  changes needed there, it was correct, just unwired.
- `src/lib/staleChunkRecovery.ts` (new): a device that's *already* stuck the
  way the reproduction device was has no in-app recovery path — React never
  mounted, so it can't show the update toast either. Vite fires
  `vite:preloadError` when a dynamic `import()` 404s exactly this way; listened
  for in `main.tsx` and reloads once, guarded by sessionStorage so a genuinely
  offline device doesn't loop, with the guard cleared once the app actually
  mounts so a *later* deploy's stale chunk still gets its own reload. Pure
  guard logic extracted so it's unit-tested rather than living directly in the
  bootstrap file.

## Verified

- `bun run lint`/`typecheck`/`test:run` (2548 tests, 186 files)/`build` all
  pass.
- Built `dist/service-worker.js` inspected directly: `self.skipWaiting()` now
  only runs inside the `SKIP_WAITING` message handler, not unconditionally on
  install.
- Confirmed live on the reproduction device, post-fix build, that a normal
  install + first load still works (this plan doesn't retroactively fix an
  already-stuck client on an *old* build — only a rider who reaches a build
  containing this fix stops hitting it going forward; `staleChunkRecovery.ts`
  is the safety net for exactly that already-stuck case once this fix ships).
