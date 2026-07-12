/**
 * Backward-compatibility barrel for the BLE module.
 *
 * The implementation lives in `src/lib/ble/` split per protocol. Existing
 * consumers import from `@/lib/bleDatalogger`; this file just re-exports
 * the public API so those imports keep working.
 *
 * Prefer `@/lib/ble` directly in new code.
 */

export * from "./ble";
