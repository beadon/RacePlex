/// <reference types="web-bluetooth" />

import type { BleConnection, BatteryInfo } from "./types";
import { bleLog } from "./internal";

/**
 * Battery Protocol.
 *
 * Send `BATT` on `fileRequest`, expect `BATT:<percent>,<voltage>` on `fileStatus`.
 */

/** Request battery level from device. Resolves with percent + voltage. */
export async function requestBatteryLevel(connection: BleConnection): Promise<BatteryInfo> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("BATT raw notification:", JSON.stringify(raw));

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("BATT:")) {
          const payload = line.substring(5);
          const [pctStr, voltStr] = payload.split(",");
          const percent = parseInt(pctStr, 10);
          const voltage = parseFloat(voltStr);
          if (!isNaN(percent) && !isNaN(voltage)) {
            cleanup();
            resolve({ percent, voltage });
            return;
          }
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
      await connection.characteristics.fileRequest.writeValue(encoder.encode("BATT"));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Battery request timed out"));
      }, 5000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
