/**
 * Internal helpers shared by every BLE protocol module.
 * Not re-exported from the public barrel.
 */

// BLE service + characteristic UUIDs (matched by the DovesLapTimer firmware)
export const SERVICE_UUID = 0x1820;
export const FILE_LIST_CHAR = 0x2A3D;
export const FILE_REQUEST_CHAR = 0x2A3E;
export const FILE_DATA_CHAR = 0x2A3F;
export const FILE_STATUS_CHAR = 0x2A40;

// Debug logging — gate verbose BLE logs behind this flag
const BLE_DEBUG = false;
export const bleLog = (...args: unknown[]) => {
  if (BLE_DEBUG) console.log("[BLE]", ...args);
};
