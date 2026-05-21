/// <reference types="web-bluetooth" />

import type { BleConnection } from "./types";
import { bleLog } from "./internal";

/**
 * Device Settings Protocol.
 *
 * Commands on `fileRequest`:
 *   SLIST             -> SVAL:key=value lines on `fileStatus`, terminated by SEND
 *   SGET:key          -> SVAL:key=value on `fileStatus`, or SERR:reason
 *   SSET:key=value    -> SOK:key on `fileStatus`, or SERR:reason
 *   SRESET            -> SOK:RESET on `fileStatus` (device reboots)
 */

/** Request all settings from device via SLIST. Returns key → value map. */
export async function requestSettingsList(
  connection: BleConnection,
): Promise<Record<string, string>> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    const settings: Record<string, string> = {};
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("SLIST raw notification:", JSON.stringify(raw));

      // Split on newlines — device may send multiple messages in one notification
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line === "SEND") {
          cleanup();
          resolve(settings);
          return;
        }
        if (line.startsWith("SVAL:")) {
          const payload = line.substring(5);
          const eqIdx = payload.indexOf("=");
          if (eqIdx > 0) {
            settings[payload.substring(0, eqIdx)] = payload.substring(eqIdx + 1);
          }
        }
      }

      // Reset safety timeout on each message
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        resolve(settings);
      }, 3000);
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("SLIST"));

      // Hard timeout after 10s
      setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for settings list"));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Get a single setting from device via SGET:key. */
export async function getDeviceSetting(
  connection: BleConnection,
  key: string,
): Promise<string> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("SGET raw notification:", JSON.stringify(raw));

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line.startsWith("SVAL:")) {
          const payload = line.substring(5);
          const eqIdx = payload.indexOf("=");
          if (eqIdx > 0 && payload.substring(0, eqIdx) === key) {
            cleanup();
            resolve(payload.substring(eqIdx + 1));
            return;
          }
        } else if (line.startsWith("SERR:")) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("SGET:" + key));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for setting value"));
      }, 5000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Reset all device settings to factory defaults via SRESET. Resolves on SOK:RESET. */
export async function resetDeviceSettings(connection: BleConnection): Promise<void> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("SRESET raw notification:", JSON.stringify(raw));

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line === "SOK:RESET") {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith("SERR:")) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("SRESET"));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for reset confirmation"));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Set a device setting via SSET:key=value. Resolves on SOK, rejects on SERR. */
export async function setDeviceSetting(
  connection: BleConnection,
  key: string,
  value: string,
): Promise<void> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("SSET raw notification:", JSON.stringify(raw));

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line === "SOK:" + key || line === "SOK: " + key) {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith("SERR:")) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode("SSET:" + key + "=" + value),
      );

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for save confirmation"));
      }, 5000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
