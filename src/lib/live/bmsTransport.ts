/**
 * JBD (Jiabaida) BMS Web Bluetooth transport (issue #73) — a third
 * concurrent BLE source alongside a primary GPS device and the optional VESC
 * sidecar (#58).
 *
 * Like VESC, this is request/response, not a push stream: nothing arrives
 * until asked. Unlike VESC, one poll cycle needs two separate requests (pack
 * telemetry and per-cell voltages come back from different commands) — this
 * alternates `COMM_BASIC_INFO`/`COMM_CELL_VOLTAGES` on each tick rather than
 * doubling the poll rate, since BMS data doesn't need GPS-rate updates.
 *
 * No fixed BLE name convention exists for JBD-family boards (the advertised
 * name is whatever was set at the factory or by the vendor app — see issue
 * #74's identity findings), so the picker shows every nearby device, same
 * reasoning `vescTransport.ts` documents.
 */

import { BmsPacketReader, buildBmsRequest } from "./bmsPacket";
import {
  COMM_BASIC_INFO,
  COMM_CELL_VOLTAGES,
  decodeBasicInfo,
  decodeCellVoltages,
  type BmsBasicInfo,
  type BmsCellVoltages,
} from "./bmsDecoder";
import { isWebBluetoothAvailable } from "./raceboxTransport";
import { withTimeout } from "./bleUtils";

const BMS_SERVICE = "0000ff00-0000-1000-8000-00805f9b34fb";
const BMS_NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb";
const BMS_WRITE = "0000ff02-0000-1000-8000-00805f9b34fb";

/** How often to poll — alternates basic-info and cell-voltages, so each individually updates every 2x this. */
const POLL_INTERVAL_MS = 1000;

/** One merged reading — cell voltages arrive on their own poll tick, so this is null until the first one lands. */
export interface BmsSample {
  basicInfo: BmsBasicInfo;
  cellVoltages: BmsCellVoltages | null;
}

export type BmsSampleListener = (sample: BmsSample, receivedAt: number) => void;

export interface BmsConnection {
  name: string;
  subscribeToSamples(listener: BmsSampleListener): () => void;
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
  };
  // `gattserverdisconnected` fires on the BluetoothDevice itself, not on
  // `.gatt` (BluetoothRemoteGATTServer has no addEventListener at all) —
  // confirmed against a real device error ("device.gatt.addEventListener is
  // not a function") after the original code (copied into every live BLE
  // transport in this codebase) got this wrong.
  addEventListener(type: string, listener: () => void): void;
}

export async function connectBmsLive(): Promise<BmsConnection> {
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "Web Bluetooth isn't available in this browser. BMS live capture needs Chrome or Edge on desktop or Android; iOS Safari and Firefox don't implement it.",
    );
  }

  const bluetooth = (navigator as unknown as {
    bluetooth: { requestDevice(options: unknown): Promise<BleDevice> };
  }).bluetooth;

  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [BMS_SERVICE],
  });

  if (!device.gatt) {
    throw new Error("This device has no GATT server — is Bluetooth actually on it?");
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BMS_SERVICE);
  const notifyChar = await service.getCharacteristic(BMS_NOTIFY);
  const writeChar = await service.getCharacteristic(BMS_WRITE);

  const reader = new BmsPacketReader();
  const listeners = new Set<BmsSampleListener>();
  let connected = true;
  let latestBasicInfo: BmsBasicInfo | null = null;
  let latestCellVoltages: BmsCellVoltages | null = null;

  const onNotify = (event: Event) => {
    const value = (event.target as { value?: DataView }).value;
    if (!value) return;
    const receivedAt = Date.now();
    for (const frame of reader.push(value)) {
      if (frame.status !== 0) continue; // BMS reported an error for this request — drop it, don't guess
      if (frame.cmd === COMM_BASIC_INFO) {
        const decoded = decodeBasicInfo(frame.data);
        if (decoded) latestBasicInfo = decoded;
      } else if (frame.cmd === COMM_CELL_VOLTAGES) {
        const decoded = decodeCellVoltages(frame.data);
        if (decoded) latestCellVoltages = decoded;
      } else {
        continue;
      }
      if (!latestBasicInfo) continue; // wait for at least one basic-info reading before emitting
      const sample: BmsSample = { basicInfo: latestBasicInfo, cellVoltages: latestCellVoltages };
      for (const listener of listeners) {
        try { listener(sample, receivedAt); } catch (e) { console.warn("BMS listener threw", e); }
      }
    }
  };

  notifyChar.addEventListener("characteristicvaluechanged", onNotify);
  await notifyChar.startNotifications();

  const basicInfoRequest = buildBmsRequest(COMM_BASIC_INFO);
  const cellVoltagesRequest = buildBmsRequest(COMM_CELL_VOLTAGES);
  let pollBasicInfoNext = true;
  const poll = window.setInterval(() => {
    if (!connected) return;
    const frame = pollBasicInfoNext ? basicInfoRequest : cellVoltagesRequest;
    pollBasicInfoNext = !pollBasicInfoNext;
    writeChar.writeValue(frame).catch((e) => console.warn("BMS poll write failed", e));
  }, POLL_INTERVAL_MS);

  device.addEventListener("gattserverdisconnected", () => {
    connected = false;
    window.clearInterval(poll);
  });

  return {
    name: device.name ?? "BMS",
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
        // A real JBD BMS has been observed to never settle this call at
        // all — a timeout guard so a hanging peripheral can't block the
        // actual GATT disconnect below.
        await withTimeout(notifyChar.stopNotifications(), 2000);
        notifyChar.removeEventListener("characteristicvaluechanged", onNotify);
      } catch { /* the device may have disconnected already; carry on. */ }
      try { device.gatt?.disconnect(); } catch { /* ditto */ }
    },
  };
}
