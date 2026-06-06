# Plan: Firmware update over Bluetooth (BLE DFU)

Status: **Planning** · Branch: `claude/firmware-bluetooth-dfu-mO0GV` → PR into `BETA`

Goal: let a user update their **DovesDataLogger** firmware straight from the web
app over Web Bluetooth — *check the installed version → fetch the latest build →
reboot the device into its bootloader → flash the new image → verify*, with a
progress UI, all without any desktop tool (`adafruit-nrfutil`, nRF Connect, etc.).

UI is still **TBD** (the maintainer is designing it). This doc locks the
*technical* plan — protocol, library choice, module layout, online/offline
behaviour, testing — so the UI can be dropped on top of a stable seam.

---

## What the hardware actually is (investigated, not assumed)

The companion logger is an **nRF52840** board (Seeed XIAO nRF52840). The OTA
manifest publishes two variants:

| Build | `variant` | Board | Notes |
|-------|-----------|-------|-------|
| `BirdsEye-sense` | `sense` | XIAO nRF52840 **Sense** | has the on-board IMU |
| `BirdsEye-nonsense` | `nonsense` | XIAO nRF52840 | no IMU |

> ⚠️ CLAUDE.md currently calls the logger an "ESP32 GPS logger". The published
> firmware is **nRF52840** (Adafruit nRF52 Arduino core). Update that line in
> CLAUDE.md / README when this lands.

### The OTA manifest (`https://theangryraven.github.io/DovesDataLogger/manifest.json`)

```jsonc
{
  "version": "2.1.0",
  "releaseTag": "v2.1.0",
  "publishedAt": "2026-06-06T06:10:26Z",
  "releaseNotes": "https://github.com/.../releases/tag/v2.1.0",
  "builds": {
    "BirdsEye-sense":    { "variant": "sense",    "dfuZip": ".../firmware/2.1.0/BirdsEye-sense.zip" },
    "BirdsEye-nonsense": { "variant": "nonsense", "dfuZip": ".../firmware/2.1.0/BirdsEye-nonsense.zip" }
  }
}
```

Served from **GitHub Pages**, which sends `access-control-allow-origin: *`, so a
browser `fetch()` of both the manifest **and** the `.zip` works cross-origin — no
proxy needed.

### The DFU package format — **legacy Adafruit nRF52 DFU, not Secure DFU**

Unzipping a `dfuZip` reveals the classic `adafruit-nrfutil` package:

```
BirdsEye.ino.bin     (~283 KB application image)
BirdsEye.ino.dat     (14-byte legacy init packet)
manifest.json        (inner DFU manifest)
```

Inner `manifest.json`:

```jsonc
{
  "manifest": {
    "application": {
      "bin_file": "BirdsEye.ino.bin",
      "dat_file": "BirdsEye.ino.dat",
      "init_packet_data": {
        "application_version": 4294967295,
        "device_revision": 65535,
        "device_type": 82,
        "firmware_crc16": 50892,
        "softdevice_req": [291]
      }
    },
    "dfu_version": 0.5
  }
}
```

`dfu_version: 0.5` + a **14-byte** `.dat` init packet + `firmware_crc16` is the
**legacy** Nordic DFU (SDK-11-era) that the **Adafruit nRF52 bootloader** speaks.
This is the single most important finding: it rules out the obvious off-the-shelf
web library (see next section).

---

## Library evaluation ("there should be some JS library…")

| Option | DFU flavour | Verdict |
|--------|-------------|---------|
| **`web-bluetooth-dfu`** (Rob Moran / thegecko, npm) | **Secure DFU** only (service `0xFE59`, signed/protobuf init packet) | ❌ **Mismatch.** Our packages are *legacy* DFU. Would only work if we re-flashed the device with a Secure DFU bootloader — a hardware/firmware migration out of scope here. |
| Nordic `pc-nrf-dfu-js` | Secure DFU, Node-oriented (serial + BLE) | ❌ Node/Electron-shaped, secure-only, heavy. |
| **Roll our own legacy DFU client** | Legacy (matches our packages) | ✅ **Recommended.** ~200 LOC, no maintained browser lib exists for legacy DFU, and it fits this repo's "we write our own BLE protocols" convention (see `src/lib/ble/`). |

**Decision: implement a small legacy-DFU-over-Web-Bluetooth client in-repo.**
Reasons: (1) the package format is legacy and no good browser library targets it;
(2) the repo already hand-rolls every BLE protocol (file/settings/track) in
`src/lib/ble/`, so this is idiomatic; (3) zero new runtime deps — **`jszip` is
already a dependency** for unpacking the `.zip`; (4) offline-first friendly (no
vendored binary blobs, pure JS).

> Alternative kept on the table: migrate the firmware to a **Secure DFU**
> bootloader and adopt `web-bluetooth-dfu`. Cleaner long-term (maintained lib,
> signed images) but a bootloader change on already-shipped hardware. Document it;
> don't block this work on it.

---

## The four capabilities, mapped to a design

### 1. Check the installed version

The device exposes **no firmware version over BLE today**. Two ways to add it, in
preference order:

- **(preferred) Reuse the settings protocol.** Have the firmware report
  `fw_version` (and `variant`: `sense`/`nonsense`) as settings keys. The app
  already reads these for free via `getDeviceSetting(conn, "fw_version")` /
  `requestSettingsList` (`src/lib/ble/settings.ts`) — **no new BLE code**, just a
  firmware addition and a `deviceSettingsSchema.ts` entry (it gracefully shows
  unknown keys already).
- (fallback) A dedicated `FWVER` command on `fileRequest` (`0x2A3E`) →
  `FW:<version>,<variant>` on `fileStatus` (`0x2A40`), mirroring the `BATT`
  pattern in `battery.ts`. Only needed if settings can't carry it.

Then compare the device version against the manifest's `version` with semver
ordering to decide "up to date" vs "update available". The variant the device
reports picks which `builds[*].dfuZip` to download.

### 2. Trigger DFU (reboot into bootloader)

To flash, the device must be in its **bootloader**, which advertises the legacy
DFU service. Get there via a **buttonless** trigger:

- **(preferred) Custom command on the existing `0x1820` service.** Add a `DFU`
  command on `fileRequest` (`0x2A3E`); firmware sets the OTA magic and resets
  (`NRF_POWER->GPREGRET = 0x…; NVIC_SystemReset();` / Adafruit `enterOTADfu()`).
  The app already owns this connection, so this is the least-surprising path.
  After writing `DFU`, the app **disconnects**, waits for the device to re-appear
  advertising the DFU service, then reconnects for the transfer.
- (standard alt) Adafruit's **BLEDfu buttonless service** if the firmware enables
  it. Same end state (reboot to bootloader); exact service/characteristic UUIDs
  **must be confirmed against the firmware** before coding.

> The device re-advertises under the bootloader with a possibly different name and
> the DFU service UUID, so the reconnect uses a fresh `requestDevice({ filters:
> [{ services: [DFU_SERVICE] }] })`. Web Bluetooth requires a user gesture per
> `requestDevice`, so the UI must surface a "select the device in DFU mode" step
> (or use `getDevices()` where permission persists).

### 3. Download the firmware locally

`fetch(manifest)` → pick `builds[<deviceVariant>].dfuZip` → `fetch(zipUrl)` →
`jszip` unpack → read `manifest.json` (inner) + the `.dat` + `.bin` as
`Uint8Array`s. Validate the inner manifest shape (`dfu_version`, `application`,
files present). This is **online-only** (a documented exception alongside weather
/ tiles / admin — firmware binaries can't ship in the offline bundle). Optionally
let the user pick a local `.zip` for fully-offline / sideload flashing.

### 4. Flash (legacy DFU transfer)

Legacy DFU service (UUIDs **to confirm against the bootloader**, typically):

| Role | UUID (legacy) |
|------|---------------|
| DFU Service | `00001530-1212-EFDE-1523-785FEEF13D00` |
| Control Point (CP) — write + notify | `00001531-…` |
| Packet — write-without-response | `00001532-…` |

Procedure (op codes on CP, image bytes on Packet):

1. `startNotifications()` on CP.
2. **Start DFU**: CP ← `[0x01, 0x04]` (0x04 = application image).
3. **Image sizes**: Packet ← 12 bytes `[sd=0, bl=0, app=binLen]` (LE u32 each).
4. Await CP notify `0x10 0x01 0x01` (success).
5. **Init params (receive)**: CP ← `[0x02, 0x00]`; Packet ← the 14-byte `.dat`;
   CP ← `[0x02, 0x01]` (complete). Await success.
6. (optional) **PRN**: CP ← `[0x08, n_lo, n_hi]` for packet-receipt pacing.
7. **Receive image**: CP ← `[0x03]`, then stream `.bin` in MTU-sized chunks
   (~20 B, or negotiated MTU) to Packet, honouring PRN receipts. Emit progress.
8. Await image-received success.
9. **Validate**: CP ← `[0x04]`. Await success.
10. **Activate & reset**: CP ← `[0x05]`. Device reboots into the new app.

Errors map CP response codes (`0x10 <op> <status>`) to friendly messages; a
mid-flash failure leaves the device safely in the bootloader (re-flashable).

---

## Module layout (fits `src/lib/ble/` conventions)

```
src/lib/ble/dfu/
├── dfuTypes.ts        # DfuPackage, DfuProgress, DfuVariant, op-code/status enums
├── dfuPackage.ts      # PURE: unzip (jszip) + parse/validate inner manifest → {initPacket, image, meta}
├── dfuProtocol.ts     # legacy DFU state machine over a BleConnection-like CP/Packet pair
├── firmwareManifest.ts# fetch + parse top-level manifest; semver compare; pick build by variant (PURE compare)
├── version.ts         # read installed version (settings key or FWVER command)
├── index.ts           # public barrel (checkFirmware, downloadFirmware, enterDfuMode, flashFirmware)
└── __test__/          # vitest for the PURE bits (package parse, manifest pick, semver, init-packet build)
```

- `firmwareManifest.ts` constant for the manifest URL (with an env override
  `VITE_FIRMWARE_MANIFEST_URL` if we want preview/staging manifests — document in
  README + CLAUDE.md env table if added).
- Reuses `BleConnection` shape; the DFU-mode connection needs its own
  service/char fetch (separate from the `0x1820` connection) — add a
  `connectToDfu()` alongside `connectToDevice()` rather than overloading the
  latter.
- Keep `dfuPackage.ts` / `firmwareManifest.ts` **pure** so they're unit-testable
  without BLE (Golden Rule #6). The protocol state machine is exercised with a
  mocked characteristic pair (same pattern as `fileTransfer.test.ts`).

---

## UI integration points (mechanism only — visual design TBD)

- **New Device sub-tab "Firmware"** (`src/components/drawer/DeviceFirmwareTab.tsx`)
  next to Settings/Tracks, behind the existing "Connect to Logger" gate. Shows:
  installed version + variant, latest version (online), Update / "Up to date"
  state, a flashing progress bar, and a sideload-`.zip` option.
- **`DeviceContext`** gains the DFU lifecycle (it already centralises connect/
  disconnect): `enterDfuAndReconnect()`, current DFU phase/progress, so the
  flashing survives tab switches like the BLE connection does.
- Surface an **"update available"** affordance wherever the device is shown
  (e.g. a dot on the Device tab) once a newer manifest version is detected online.
- Strong **safety copy**: keep the device close, don't close the tab, battery
  warning (gate on `requestBatteryLevel()` ≥ some threshold before flashing).

---

## Offline-first & safety

- Reading the installed version and flashing a **user-provided local `.zip`** work
  fully offline. Only **fetching the published manifest + binary** needs network —
  a documented exception (like weather/tiles/admin), behind `useOnlineStatus`.
- Never auto-flash. Explicit user action, explicit variant match (refuse to flash
  a `sense` image to a `nonsense` device and vice-versa), battery check first.
- A failed/interrupted flash leaves the device in the bootloader (recoverable);
  the UI should detect "device is already in DFU mode" on next connect and offer
  to resume/retry.

---

## Cross-repo dependency (firmware side)

This app change pairs with small **DovesDataLogger firmware** additions
(separate repo, separate PR):
1. report `fw_version` + `variant` (settings key — preferred — or `FWVER` cmd);
2. a buttonless **`DFU`** command on `0x2A3E` that reboots into the OTA
   bootloader.

The app should **degrade gracefully** when talking to firmware that lacks these
(no version key → "unknown, can't check"; no DFU command → fall back to the
standard buttonless service or a manual "hold button to enter DFU" instruction).

---

## Phasing

- **Phase 1** — `dfuPackage` + `firmwareManifest` (pure, tested) + `dfuProtocol`
  state machine against a mocked CP/Packet; version read via settings; a minimal
  Firmware tab that checks version and flashes. Online manifest fetch.
- **Phase 2** — polish: progress/ETA reuse of `format.ts`, battery gate, sideload
  `.zip`, "update available" badge, resume-from-bootloader, MTU negotiation/PRN
  tuning for speed.
- **Phase 3** — (optional) evaluate migrating firmware to Secure DFU +
  `web-bluetooth-dfu` for signed images.

---

## Docs to update when code lands

- **CLAUDE.md**: fix "ESP32" → "nRF52840"; add `src/lib/ble/dfu/` to the
  architecture map + a "Firmware DFU" section; new `0x2A3E` `DFU`/`FWVER` commands
  in the BLE protocol table; any new env var.
- **README.md**: a "Firmware update" user section; env var table if
  `VITE_FIRMWARE_MANIFEST_URL` is added; credits (none new — `jszip` already
  credited).
- **CHANGELOG.md**: user-facing "Update logger firmware over Bluetooth" under
  `[Unreleased]` when the feature ships (not for this plan-only PR).

---

## Open questions for the maintainer

1. **Version source**: settings key `fw_version` (preferred, free in the app) or a
   dedicated `FWVER` command? Need the matching firmware change either way.
2. **DFU trigger**: add a custom `DFU` command on `0x1820` (preferred), or rely on
   Adafruit's BLEDfu buttonless service? If the latter, what are its exact UUIDs?
3. **Reconnect UX**: the bootloader needs a second `requestDevice` (user gesture).
   Acceptable, or do we want to lean on persisted `getDevices()` permission?
4. **Manifest URL**: hardcode the GitHub Pages URL, or make it env-configurable
   for preview firmware channels?
5. **Long-term**: any appetite for moving to Secure DFU (Phase 3)?
