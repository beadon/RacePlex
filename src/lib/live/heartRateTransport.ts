/**
 * Bluetooth SIG standard Heart Rate Service transport (issue #87) — a fourth
 * concurrent BLE source alongside a primary GPS device and the optional
 * VESC/BMS sidecars (#58, #73).
 *
 * Unlike VESC/BMS, this is an openly documented GATT profile every
 * compliant device already speaks (Polar, Wahoo, Garmin, an Apple Watch
 * running an active Workout session, most fitness watches) — no protocol
 * reverse-engineering, and the service itself pushes notifications rather
 * than needing a poll loop the way VESC's request/response UART does.
 *
 * Filtering on the Heart Rate Service UUID alone (rather than
 * `acceptAllDevices`, which VESC/BMS are stuck with for lack of a
 * distinguishing service) already narrows the picker to just compatible
 * devices. When a device has connected before, `heartRateDevicePreference`'s
 * remembered name narrows it further still — the closest real equivalent
 * Web Bluetooth allows to "put it at the top of the list", since nothing
 * can reorder or replace the browser's own picker UI.
 */

import { decodeHeartRateMeasurement, type HeartRateSample } from "./heartRateDecoder";
import { getLastHeartRateDeviceName, setLastHeartRateDeviceName } from "./heartRateDevicePreference";
import { isWebBluetoothAvailable } from "./raceboxTransport";
import { withTimeout } from "./bleUtils";

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;

export type HeartRateSampleListener = (sample: HeartRateSample, receivedAt: number) => void;

export interface HeartRateConnection {
  name: string;
  subscribeToSamples(listener: HeartRateSampleListener): () => void;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

interface BleCharacteristic {
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  value?: DataView;
}
interface BleDevice {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: number): Promise<{ getCharacteristic(uuid: number): Promise<BleCharacteristic> }> }>;
    disconnect(): void;
  };
  // `gattserverdisconnected` fires on the BluetoothDevice itself, not on
  // `.gatt` (BluetoothRemoteGATTServer has no addEventListener at all).
  addEventListener(type: string, listener: () => void): void;
}

export async function connectHeartRateLive(): Promise<HeartRateConnection> {
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "Web Bluetooth isn't available in this browser. A live heart-rate connection needs Chrome or Edge on desktop or Android; iOS Safari and Firefox don't implement it.",
    );
  }

  const bluetooth = (navigator as unknown as {
    bluetooth: { requestDevice(options: unknown): Promise<BleDevice> };
  }).bluetooth;

  const preferredName = getLastHeartRateDeviceName();
  const device = await bluetooth.requestDevice(
    preferredName
      ? { filters: [{ services: [HEART_RATE_SERVICE], name: preferredName }] }
      : { filters: [{ services: [HEART_RATE_SERVICE] }] },
  );

  if (!device.gatt) {
    throw new Error("This device has no GATT server — is Bluetooth actually on it?");
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(HEART_RATE_SERVICE);
  const measurementChar = await service.getCharacteristic(HEART_RATE_MEASUREMENT);

  const listeners = new Set<HeartRateSampleListener>();
  let connected = true;

  const onNotify = (event: Event) => {
    const value = (event.target as { value?: DataView }).value;
    if (!value) return;
    const sample = decodeHeartRateMeasurement(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    if (!sample) return;
    const receivedAt = Date.now();
    for (const listener of listeners) {
      try { listener(sample, receivedAt); } catch (e) { console.warn("Heart rate listener threw", e); }
    }
  };

  measurementChar.addEventListener("characteristicvaluechanged", onNotify);
  await measurementChar.startNotifications();

  device.addEventListener("gattserverdisconnected", () => {
    connected = false;
  });

  if (device.name) setLastHeartRateDeviceName(device.name);

  return {
    name: device.name ?? "Heart rate monitor",
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
        // Other sidecar transports have observed a real device never settle
        // this call at all — a timeout guard so a hanging peripheral can't
        // block the actual GATT disconnect below.
        await withTimeout(measurementChar.stopNotifications(), 2000);
        measurementChar.removeEventListener("characteristicvaluechanged", onNotify);
      } catch { /* the device may have disconnected already; carry on. */ }
      try { device.gatt?.disconnect(); } catch { /* ditto */ }
    },
  };
}
