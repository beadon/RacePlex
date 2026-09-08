/**
 * VESC Web Bluetooth transport (issue #58) — the secondary source in a
 * concurrent capture, connected alongside a primary GPS device.
 *
 * Unlike RaceBox/Dragy, VESC has no fixed BLE device-name convention (it's
 * whatever the builder set in VESC Tool, often left at the firmware
 * default) — so unlike `connectRaceBoxLive()`'s `namePrefix` filter, this
 * defaults to showing every nearby BLE device in the picker and lets the
 * rider recognize their own board's name. An explicit `namePrefix` is still
 * supported for a known setup.
 *
 * VESC's BLE UART bridge (`nrf52_vesc`, VESC's own official firmware) is the
 * same Nordic UART Service RaceBox/Dragy use, but it's request/response, not
 * a push stream: nothing arrives until asked. This polls `COMM_GET_VALUES`
 * on an interval and decodes each response.
 */

import { VescPacketReader } from "./vescPacket";
import { buildGetValuesRequest, decodeGetValues, type VescValues } from "./vescDecoder";
import { encodeVescPacket } from "./vescPacket";
import { isWebBluetoothAvailable } from "./raceboxTransport";

const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_NOTIFY = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_WRITE = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

/** How often to poll COMM_GET_VALUES. VESC telemetry doesn't need GPS-rate polling. */
const POLL_INTERVAL_MS = 100;

export type VescSampleListener = (sample: VescValues, receivedAt: number) => void;

export interface VescConnection {
  name: string;
  subscribeToSamples(listener: VescSampleListener): () => void;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

interface BleCharacteristic {
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  writeValue(data: Uint8Array): Promise<void>;
  value?: DataView;
}
interface BleDevice {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleCharacteristic> }> }>;
    disconnect(): void;
    addEventListener(type: string, listener: () => void): void;
  };
}

export async function connectVescLive(options?: { namePrefix?: string }): Promise<VescConnection> {
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "Web Bluetooth isn't available in this browser. VESC live capture needs Chrome or Edge on desktop or Android; iOS Safari and Firefox don't implement it.",
    );
  }

  const bluetooth = (navigator as unknown as {
    bluetooth: { requestDevice(options: unknown): Promise<BleDevice> };
  }).bluetooth;

  const device = await bluetooth.requestDevice(
    options?.namePrefix
      ? { filters: [{ namePrefix: options.namePrefix }], optionalServices: [NUS_SERVICE] }
      // No universal VESC BLE name convention — show every device and let the
      // rider recognize their own board, same reasoning DevicesTile documents
      // for why this can't be a curated list.
      : { acceptAllDevices: true, optionalServices: [NUS_SERVICE] },
  );

  if (!device.gatt) {
    throw new Error("This device has no GATT server — is Bluetooth actually on it?");
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS_SERVICE);
  const notifyChar = await service.getCharacteristic(NUS_NOTIFY);
  const writeChar = await service.getCharacteristic(NUS_WRITE);

  const reader = new VescPacketReader();
  const listeners = new Set<VescSampleListener>();
  let connected = true;

  const onNotify = (event: Event) => {
    const value = (event.target as { value?: DataView }).value;
    if (!value) return;
    const receivedAt = Date.now();
    for (const payload of reader.push(value)) {
      const sample = decodeGetValues(payload);
      if (!sample) continue;
      for (const listener of listeners) {
        try { listener(sample, receivedAt); } catch (e) { console.warn("VESC listener threw", e); }
      }
    }
  };

  notifyChar.addEventListener("characteristicvaluechanged", onNotify);
  await notifyChar.startNotifications();

  const requestFrame = encodeVescPacket(buildGetValuesRequest());
  const poll = window.setInterval(() => {
    if (!connected) return;
    writeChar.writeValue(requestFrame).catch((e) => console.warn("VESC poll write failed", e));
  }, POLL_INTERVAL_MS);

  device.gatt.addEventListener("gattserverdisconnected", () => {
    connected = false;
    window.clearInterval(poll);
  });

  return {
    name: device.name ?? "VESC",
    isConnected: () => connected && !!device.gatt?.connected,
    subscribeToSamples(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async disconnect() {
      if (!connected) return;
      connected = false;
      window.clearInterval(poll);
      listeners.clear();
      try {
        await notifyChar.stopNotifications();
        notifyChar.removeEventListener("characteristicvaluechanged", onNotify);
      } catch { /* the device may have disconnected already; carry on. */ }
      try { device.gatt?.disconnect(); } catch { /* ditto */ }
    },
  };
}
