# Unify BLE Connection State

## The bug

There are **three parallel BLE connection silos** in the app right now:

1. `DeviceContext` (`src/contexts/DeviceContext.tsx`) — used by the side drawer's Device tab.
2. `DataloggerDownload` mounted in the **main menu** (`FileImport.tsx`) — holds its own `useState<BleConnection|null>`.
3. `DataloggerDownload` mounted inside the **drawer's Files tab** (`FilesTab.tsx`) — same component, another independent local state.

When you download a log from the main menu, instance #2 owns a live GATT connection. `DeviceContext` (#1) never hears about it, so when you open the drawer it shows the "Connect to Logger" prompt as if nothing is connected — and clicking Connect tries to open a *second* GATT session to the same device, which is what causes the panic. Closing the download dialog also blindly calls `disconnect()`, which would yank a connection out from under the drawer if both were active.

## The fix

Make `DeviceContext` the single source of truth for the BLE connection. `DataloggerDownload` becomes a *consumer* of the context instead of an owner.

### Changes

**`src/contexts/DeviceContext.tsx`**
- Already exposes `connection`, `connect()`, `disconnectDevice()`. Keep as the canonical owner.
- Add a small helper for status-message piping during connect (optional `onStatus` arg) so `DataloggerDownload` can still show "Scanning..." / "Pairing..." text in its dialog. Either:
  - extend `connect()` to accept an optional `(msg: string) => void`, or
  - expose the latest status string via context state.
  Prefer the callback form — simpler, no extra re-renders.

**`src/components/DataloggerDownload.tsx`**
- Remove local `const [connection, setConnection] = useState<BleConnection | null>`.
- Pull `connection`, `connect`, `disconnectDevice` from `useDeviceContext()`.
- `handleConnect`: if `connection` already exists, skip `connect()` and jump straight to `requestFileList(connection, ...)`. Otherwise call `device.connect(setStatusMessage)`, then read the now-populated `connection` (await the returned conn — have `connect()` return the `BleConnection` on success rather than just `boolean`, so we don't have to wait for a re-render).
- `handleFileSelect`: use the context's `connection`.
- `handleClose`: **do not disconnect**. Just close the dialog and reset local UI state (files list, progress, error). The connection persists for the drawer / future downloads. Only the explicit "Disconnect" button in the drawer header should tear down GATT.
- Keep the BLE-supported tooltip behavior.

**`src/components/FileManagerDrawer.tsx`**
- No structural changes needed — it already reads from `useDeviceContext()`. Once #2 and #3 share the context, opening the drawer right after a main-menu download will correctly show the device as connected and skip the connect prompt.
- Minor: battery state currently lives in the drawer and resets on close. Optional follow-up — move `battery` into `DeviceContext` so it survives drawer close/open. Not required to fix the reported bug.

**`src/pages/Index.tsx`**
- `DeviceProvider` already wraps both the no-data and data-loaded branches. No change.

### Edge cases to handle

- **Unexpected disconnect mid-download**: `DeviceContext` already listens for `gattserverdisconnected` and clears state. `DataloggerDownload` should react to `connection` going `null` while in `downloading`/`fetching-files` state and surface an error rather than hanging.
- **Connect button while a connection exists**: short-circuit and proceed to file list.
- **Drawer "Disconnect" pressed while download dialog is open**: the dialog will see `connection === null` via context and should drop into its error state.

### Files touched

- `src/contexts/DeviceContext.tsx` — extend `connect()` signature to accept status callback and return the `BleConnection | null`.
- `src/components/DataloggerDownload.tsx` — switch from local state to context; stop disconnecting on dialog close; react to context disconnects.
- (No changes needed in `FilesTab.tsx`, `FileImport.tsx`, `FileManagerDrawer.tsx`, `bleDatalogger.ts`.)

### Out of scope

- Refactoring `DeviceTracksTab` / `DeviceSettingsTab` — they already receive `connection` as a prop from the drawer, which now resolves from context. Fine as-is.
- Battery info hoisting (noted as optional follow-up).
