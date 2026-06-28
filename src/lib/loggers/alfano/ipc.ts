/**
 * Native (Tauri) IPC client for the Alfano downloader — SKELETON.
 *
 * Alfano loggers talk over **Bluetooth serial** (Classic Bluetooth SPP), which
 * Web Bluetooth can't reach (it only does BLE GATT). So unlike the Fledgling
 * there is no web path at all — Alfano downloads only ever run through the native
 * (Tauri) shell. The Rust backend (`logger_scan` / `logger_connect` /
 * `logger_serial_*`) is still TBD; this module is the web-side seam it plugs into.
 *
 * The kind-agnostic commands (list / download / device info / disconnect) and the
 * memoized `@tauri-apps/api` loader live in `../native/ipc` and are shared with the
 * other native loggers; this module adds only the Alfano-specific `logger_scan`
 * and `logger_connect` (both tagged `kind: "alfano"`), and re-exports the shared
 * surface so `alfanoConnection.ts` imports everything from here.
 *
 * Arg keys are camelCase and every command rejects with a plain string whose
 * prefix encodes the error category (`device unreachable:`, `device hung:`,
 * `protocol error:`, `unsupported:`, `no logger connected …`). We pass those
 * strings through unwrapped so the UI can match on the prefix.
 */

import { api, type LoggerDeviceInfo } from "../native/ipc";

// Re-export the shared native surface so Alfano callers import it all from here.
export {
  loggerDeviceInfo,
  loggerListFiles,
  loggerDownloadFile,
  loggerDisconnect,
} from "../native/ipc";
export type { LoggerDeviceInfo, FileEntry, DownloadProgress } from "../native/ipc";

/**
 * An Alfano found during a Bluetooth-serial scan. `name`/`rssi` are DISPLAY ONLY
 * (so the user recognizes their device); selection is by `id` (the transport
 * address, passed back as `host` to `loggerConnect`).
 */
export interface ScannedDevice {
  /** Transport address — pass back as `host` to `loggerConnect`. */
  id: string;
  /** Advertised name — display only. */
  name?: string;
  /** Signal strength, for sorting / display. */
  rssi?: number;
}

/** Scan for nearby Alfano loggers reachable over Bluetooth serial (native only). */
export async function loggerScan(): Promise<ScannedDevice[]> {
  const { invoke } = await api();
  return invoke<ScannedDevice[]>("logger_scan", { kind: "alfano" });
}

/**
 * Connect to an Alfano over Bluetooth serial. `host` is the chosen
 * `ScannedDevice.id`; omitting it connects to the first logger found (the picker
 * is the intended UX).
 */
export async function loggerConnect(opts: { host?: string } = {}): Promise<LoggerDeviceInfo> {
  const { invoke } = await api();
  return invoke<LoggerDeviceInfo>("logger_connect", {
    kind: "alfano",
    host: opts.host,
  });
}
