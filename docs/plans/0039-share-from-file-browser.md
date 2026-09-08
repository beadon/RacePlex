# 0039 — Share a session from the file browser

**Status:** done

## Problem

Plan 0037 added a "Share" button to the phone-GPS recorder's "session saved"
screen, using the OS share sheet to hand a session file to someone else. That
mechanism was tied to the recorder — any other session (already imported, or
recorded earlier) had no way to be shared, only downloaded or deleted.

## What changed

The file browser's per-session row (`FilesTab.tsx`) gained a Share icon
button alongside the existing Download and Delete, calling the same
`shareOrDownloadSession()` from `src/lib/shareSession.ts`.

- `useFileManager.ts` gained `shareFile(name)`: fetches the blob via
  `getFile()` (the same lookup `exportFile` uses) and calls
  `shareOrDownloadSession()`.
- Threaded through as `onShareFile` alongside the existing `onExportFile`:
  `Index.tsx`'s `fileManagerProps` → `FileManagerDrawer` → `FilesTab`.
- `FilesTab` tracks which row is mid-share (`sharingFile`) and disables that
  row's button for the duration, the same pattern `LapTimerTool`'s Share
  button uses.

Cloud-only rows (not yet downloaded to this device) don't get a Share button
— sharing needs a local blob, and downloading one is already a tap away via
the existing "tap to download" row behavior.

## Files

- `src/hooks/useFileManager.ts` — `shareFile()`.
- `src/pages/Index.tsx`, `src/components/FileManagerDrawer.tsx`,
  `src/components/drawer/FilesTab.tsx` — thread `onShareFile` through, add
  the row button.
- `src/locales/en/drawer.json` — `files.share` key.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2703 tests) /
`bun run build` all green. Verified live via `bun run dev`: Garage → Files →
a session row now shows Share/Download/Delete icons; clicking Share
completes without error (this browser has no file-sharing OS integration, so
it falls back to a download, exercising the same fallback path
`shareSession.test.ts` covers).
