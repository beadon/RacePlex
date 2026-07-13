/**
 * Dragy Web Bluetooth transport (issue #32).
 *
 * Two characteristics on service FD00: FD03 for the handshake (a 2-byte
 * challenge in, a 4-byte reply back), and FD02 for the telemetry notify
 * stream. Firmware-dependent — the challenge/reply may change without
 * notice, and passive-subscribe never yields anything without the reply.
 *
 * `dragy-dash` is our reference (MIT). If a rider reports a stall, run
 * with `?dbg=true` and inspect the debug console for the challenge bytes;
 * a printable comparison against dragy-dash's own logs usually pinpoints
 * the change.
 */

import { UbxRingBuffer } from "./ubxRingBuffer";
import { decodeDragyPacket, type DragySample } from "./dragyDecoder";
import { dragyHandshakeReply } from "./dragyHandshake";
import { isWebBluetoothAvailable } from "./raceboxTransport";

const DRAGY_SERVICE = 0xfd00;
const DRAGY_HANDSHAKE = 0xfd03;
const DRAGY_TELEMETRY = 0xfd02;

export type DragySampleListener = (sample: DragySample) => void;

export interface DragyConnection {
  name: string;
  subscribeToSamples(listener: DragySampleListener): () => void;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

/**
 * Prompt the user to pick a Dragy and open a live-capture connection. Runs
 * the handshake before subscribing — the device stays silent otherwise.
 */
export async function connectDragyLive(): Promise<DragyConnection> {
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "Web Bluetooth isn't available in this browser. Dragy live capture needs Chrome or Edge on desktop or Android; iOS Safari and Firefox don't implement it.",
    );
  }

  const bluetooth = (navigator as unknown as { bluetooth: {
    requestDevice(options: unknown): Promise<{
      name?: string;
      gatt?: {
        connected: boolean;
        connect(): Promise<{
          getPrimaryService(uuid: number | string): Promise<{
            getCharacteristic(uuid: number | string): Promise<{
              readValue(): Promise<DataView>;
              writeValue(bytes: BufferSource): Promise<void>;
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
    filters: [{ services: [DRAGY_SERVICE] }],
    optionalServices: [DRAGY_SERVICE],
  });
  if (!device.gatt) throw new Error("This device has no GATT server — is it a Dragy?");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(DRAGY_SERVICE);
  const handshakeChar = await service.getCharacteristic(DRAGY_HANDSHAKE);
  const telemetryChar = await service.getCharacteristic(DRAGY_TELEMETRY);

  // Read the challenge, compute the reply, write it back. The device begins
  // sending telemetry moments after the write acknowledges.
  const challenge = await handshakeChar.readValue();
  const reply = dragyHandshakeReply(new Uint8Array(challenge.buffer, challenge.byteOffset, challenge.byteLength));
  await handshakeChar.writeValue(reply.buffer as ArrayBuffer);

  const ring = new UbxRingBuffer();
  const listeners = new Set<DragySampleListener>();
  let connected = true;

  const onNotify = (event: Event) => {
    const value = (event.target as { value?: DataView }).value;
    if (!value) return;
    for (const packet of ring.push(value)) {
      const sample = decodeDragyPacket(packet);
      if (!sample || !sample.fixOk) continue;
      for (const l of listeners) {
        try { l(sample); } catch (e) { console.warn("Dragy listener threw", e); }
      }
    }
  };

  telemetryChar.addEventListener("characteristicvaluechanged", onNotify);
  await telemetryChar.startNotifications();

  device.gatt.addEventListener("gattserverdisconnected", () => { connected = false; });

  return {
    name: device.name ?? "Dragy",
    isConnected: () => connected && !!device.gatt?.connected,
    subscribeToSamples(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async disconnect() {
      if (!connected) return;
      connected = false;
      listeners.clear();
      try {
        await telemetryChar.stopNotifications();
        telemetryChar.removeEventListener("characteristicvaluechanged", onNotify);
      } catch { /* device may already be gone */ }
      try { device.gatt?.disconnect(); } catch { /* ditto */ }
    },
  };
}
