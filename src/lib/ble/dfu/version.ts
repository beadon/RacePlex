/// <reference types="web-bluetooth" />

/**
 * Read the installed firmware identity from the standard Device Information
 * Service (`0x180A`). The firmware publishes it via Adafruit `BLEDis`:
 *   - Firmware Revision (0x2A26): version string, e.g. "2.1.0"
 *   - Model Number     (0x2A24): "BirdsEye-<variant>", e.g. "BirdsEye-sense"
 *   - Manufacturer     (0x2A29): "DovesDataLogger"
 *
 * No custom characteristic — the app is a pure consumer of standard BLE. The
 * model→variant mapping is pure (exported for tests); the DIS read is degrade-
 * gracefully (missing characteristics resolve to `null`).
 */

import type { DeviceFirmwareInfo } from "./dfuTypes";

/** Device Information Service. */
export const DIS_SERVICE_UUID = 0x180a;
/** Model Number String. */
export const DIS_MODEL_UUID = 0x2a24;
/** Firmware Revision String. */
export const DIS_FIRMWARE_REV_UUID = 0x2a26;
/** Manufacturer Name String. */
export const DIS_MANUFACTURER_UUID = 0x2a29;

/**
 * Derive the variant from a DIS model string. "BirdsEye-sense" → "sense".
 * Returns `null` when the model isn't in the expected `Name-variant` shape.
 * Pure.
 */
export function parseVariantFromModel(model: string | null): string | null {
  if (!model) return null;
  const idx = model.lastIndexOf("-");
  if (idx < 0 || idx === model.length - 1) return null;
  return model.slice(idx + 1).trim().toLowerCase() || null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether an error looks like a transient GATT contention error (Web Bluetooth
 * serializes GATT access). The version read can briefly collide with the Settings
 * tab's concurrent SLIST fetch — retrying clears it. A genuine NotFoundError
 * (missing characteristic) is NOT transient, so it fails fast.
 */
function isBusyError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  // Chrome surfaces concurrent GATT ops as a NetworkError, message
  // "GATT operation already in progress." / "GATT operation failed for unknown reason."
  return (
    name === "NetworkError" ||
    msg.includes("in progress") ||
    msg.includes("network") ||
    msg.includes("unknown reason")
  );
}

/** Retry `fn` while it fails with a transient busy error (~2s total window). */
async function withBusyRetry<T>(fn: () => Promise<T>, attempts = 10, delayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt === attempts - 1) throw error;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** Read one DIS string characteristic, returning `null` if absent/unreadable. */
async function readStringChar(
  service: BluetoothRemoteGATTService,
  uuid: number,
): Promise<string | null> {
  try {
    const char = await withBusyRetry(() => service.getCharacteristic(uuid));
    const value = await withBusyRetry(() => char.readValue());
    return new TextDecoder().decode(value).replace(/\0+$/, "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read firmware version/variant/manufacturer from the device's DIS. Requires
 * `0x180A` to be exposed (add it to the connection's `optionalServices`).
 * Throws only when the DIS itself is unavailable; individual missing fields
 * resolve to `null`.
 */
export async function readDeviceFirmwareInfo(
  server: BluetoothRemoteGATTServer,
): Promise<DeviceFirmwareInfo> {
  let service: BluetoothRemoteGATTService;
  try {
    service = await withBusyRetry(() => server.getPrimaryService(DIS_SERVICE_UUID));
  } catch {
    throw new Error(
      "Device Information Service not available — cannot read firmware version",
    );
  }

  // Web Bluetooth serializes GATT operations — read sequentially, never via
  // Promise.all (concurrent reads throw "GATT operation already in progress").
  const version = await readStringChar(service, DIS_FIRMWARE_REV_UUID);
  const model = await readStringChar(service, DIS_MODEL_UUID);
  const manufacturer = await readStringChar(service, DIS_MANUFACTURER_UUID);

  return { version, model, variant: parseVariantFromModel(model), manufacturer };
}
