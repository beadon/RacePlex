/**
 * Shared Web Bluetooth helpers used by every transport in `lib/live/`.
 *
 * `withTimeout` exists because of a real, confirmed failure mode: on a real
 * JBD BMS, `notifyChar.stopNotifications()` never settled (neither resolved
 * nor rejected) during `disconnect()`. Since every transport's disconnect
 * flow awaited that call before reaching `device.gatt?.disconnect()`, the
 * hang left the app-level polling stopped but the actual GATT connection
 * held at the OS level forever — confirmed via `adb shell dumpsys
 * bluetooth_manager` still showing an active connection minutes later. A
 * `disconnect()` flow must never let one BLE operation's failure to respond
 * block the rest of teardown.
 */

/** Race `promise` against a timeout; resolves to `undefined` if the timeout wins. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
}
