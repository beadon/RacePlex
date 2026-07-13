/**
 * RaceBox Web Bluetooth transport (issue #32).
 *
 * Handles: discovery, connect, GATT services + characteristics, subscribing
 * to the notify characteristic, and pumping incoming bytes through the UBX
 * ring buffer + RaceBox decoder. The result is an object with a
 * `subscribeToSamples(cb)` method — every good-fix `RaceBoxSample` flows
 * through, and the caller decides what to do (append to a live session,
 * mirror to a chart, save a snapshot).
 *
 * ### The GATT surface (per the RaceBox protocol PDF, Rev 8)
 *
 * Nordic UART Service:
 *   - Service:    6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *   - Notify:     6e400003-b5a3-f393-e0a9-e50e24dcca9e (device → phone)
 *   - Write:      6e400002-b5a3-f393-e0a9-e50e24dcca9e (phone → device)
 *
 * `requestDevice` filters on `namePrefix: 'RaceBox'`; a rider must confirm
 * the pick in Chrome's picker (Web Bluetooth requires a user gesture).
 *
 * ### Web Bluetooth availability
 *
 * Only Chromium-family browsers implement Web Bluetooth. iOS Safari, Firefox,
 * and any WKWebView have no support. The `isWebBluetoothAvailable()` helper
 * lets callers gate the UI honestly — a broken "Connect" button is worse
 * than one that says "Bluetooth pairing needs Chrome/Edge on desktop or
 * Android."
 */

import { UbxRingBuffer } from "./ubxRingBuffer";
import {
  RACEBOX_CLASS,
  RACEBOX_LIVE_ID,
  decodeRaceBoxPacket,
  type RaceBoxSample,
} from "./raceboxDecoder";

const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_NOTIFY = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
// Write characteristic reserved for future commands (record download, config).
// Kept here so the constant lives with its cousins and is easy to find.
export const RACEBOX_NUS_WRITE = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

/** True when the browser exposes the Web Bluetooth surface RaceBox needs. */
export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== "undefined"
    && "bluetooth" in navigator
    && typeof (navigator.bluetooth as unknown as { requestDevice?: unknown }).requestDevice === "function";
}

export type SampleListener = (sample: RaceBoxSample) => void;

/**
 * An open connection to a RaceBox. Callers hold this for the life of the
 * capture and call `disconnect()` when done. Every subscribe returns an
 * `unsubscribe` function — no leaks even if the caller forgets one channel.
 */
export interface RaceBoxConnection {
  /** Human-friendly device name (whatever the RaceBox advertised). */
  name: string;
  /** Register a listener for every good-fix sample. Returns unsubscribe. */
  subscribeToSamples(listener: SampleListener): () => void;
  /** Whether the underlying BLE connection is currently active. */
  isConnected(): boolean;
  /** Close the connection and unsubscribe every listener. Idempotent. */
  disconnect(): Promise<void>;
}

/**
 * Prompt the user to pick a RaceBox and open a live-capture connection.
 * Throws on cancel, unsupported browser, or GATT failure — the caller shows
 * whatever UI is right for their surface.
 *
 * NOTE: only the LIVE stream (class 0xFF, id 0x01) is emitted here. Recorded
 * downloads (id 0x21) come from a different flow that issues a command on
 * the write characteristic and reads a bulk stream back — see the follow-up
 * slice.
 */
export async function connectRaceBoxLive(options?: {
  /** Skip the picker and pair with the specified device id. Rarely needed. */
  namePrefix?: string;
}): Promise<RaceBoxConnection> {
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "Web Bluetooth isn't available in this browser. RaceBox live capture needs Chrome or Edge on desktop or Android; iOS Safari and Firefox don't implement it.",
    );
  }

  const bluetooth = (navigator as unknown as { bluetooth: {
    requestDevice(options: unknown): Promise<{
      name?: string;
      gatt?: {
        connected: boolean;
        connect(): Promise<{
          getPrimaryService(uuid: string): Promise<{
            getCharacteristic(uuid: string): Promise<{
              startNotifications(): Promise<unknown>;
              stopNotifications(): Promise<unknown>;
              addEventListener(type: string, listener: (event: Event) => void): void;
              removeEventListener(type: string, listener: (event: Event) => void): void;
              value?: DataView;
            }>;
          }>;
        }>;
        disconnect(): void;
        addEventListener(type: string, listener: () => void): void;
      };
    }>;
  }; }).bluetooth;

  const device = await bluetooth.requestDevice({
    filters: [{ namePrefix: options?.namePrefix ?? "RaceBox" }],
    optionalServices: [NUS_SERVICE],
  });

  if (!device.gatt) {
    throw new Error("This device has no GATT server — is it a RaceBox?");
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS_SERVICE);
  const notifyChar = await service.getCharacteristic(NUS_NOTIFY);

  const ring = new UbxRingBuffer();
  const listeners = new Set<SampleListener>();
  let connected = true;

  const onNotify = (event: Event) => {
    const value = (event.target as { value?: DataView }).value;
    if (!value) return;
    for (const packet of ring.push(value)) {
      // Recorded packets (id 0x21) can share a live subscription in some
      // firmwares — but the live capture flow only cares about the live
      // stream, so filter to 0x01 here.
      if (packet.cls !== RACEBOX_CLASS || packet.id !== RACEBOX_LIVE_ID) continue;
      const sample = decodeRaceBoxPacket(packet);
      if (!sample || !sample.fixOk) continue;
      for (const listener of listeners) {
        try { listener(sample); } catch (e) { console.warn("RaceBox listener threw", e); }
      }
    }
  };

  notifyChar.addEventListener("characteristicvaluechanged", onNotify);
  await notifyChar.startNotifications();

  device.gatt.addEventListener("gattserverdisconnected", () => {
    connected = false;
  });

  return {
    name: device.name ?? "RaceBox",
    isConnected: () => connected && !!device.gatt?.connected,
    subscribeToSamples(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async disconnect() {
      if (!connected) return;
      connected = false;
      listeners.clear();
      try {
        await notifyChar.stopNotifications();
        notifyChar.removeEventListener("characteristicvaluechanged", onNotify);
      } catch { /* the device may have disconnected already; carry on. */ }
      try { device.gatt?.disconnect(); } catch { /* ditto */ }
    },
  };
}
