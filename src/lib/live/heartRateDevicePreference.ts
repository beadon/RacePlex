/**
 * Remembers the last-connected heart-rate device's BLE name (issue #87) —
 * localStorage, not a Vehicle field: a heart-rate monitor belongs to the
 * rider, not the board, so it stays independent of the Garage/VESC/BMS
 * binding (`sidecarVehicleBinding.ts`, plan 0030).
 *
 * Web Bluetooth gives no way to render our own device list or reorder the
 * browser's own picker — the closest real equivalent to "put it at the top"
 * is narrowing `requestDevice()`'s filter to the remembered device by exact
 * name once we know it, so a repeat connection shows only (or mostly) that
 * one device instead of every nearby Heart Rate Service advertiser.
 */

const STORAGE_KEY = 'raceplex-heart-rate-device-v1';

export function getLastHeartRateDeviceName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastHeartRateDeviceName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Best-effort — a rider without localStorage access just re-scans every time.
  }
}
