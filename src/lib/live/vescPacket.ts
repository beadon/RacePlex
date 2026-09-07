/**
 * VESC COMM packet framing (issue #58) — the wire format VESC's own firmware
 * uses over UART, USB, CAN and its official nRF52 BLE UART bridge alike.
 * Unlike RaceBox/Dragy's UBX framing (`ubxRingBuffer.ts`), VESC is a
 * request/response protocol: nothing streams until asked (`vescTransport.ts`
 * polls `COMM_GET_VALUES` on an interval).
 *
 * Frame format (VESC firmware `packet.c`, mirrored at
 * vedderb-bldc.mintlify.app/communication/uart-protocol):
 *
 *     start(1) | length(1 or 2) | payload | crc16(2, big-endian) | stop(1)
 *
 *   - start = 0x02 for a length that fits one byte (payload ≤ 255), 0x03 for
 *     a two-byte (big-endian) length. Every payload this module builds or
 *     expects is small, so only the short (0x02) form is emitted, but both
 *     are accepted on read since a real VESC's response size varies by
 *     firmware version (later firmware appends more telemetry fields).
 *   - stop = 0x03 always, regardless of the start byte.
 *   - CRC-16/XMODEM (poly 0x1021, init 0x0000, no reflection) over the payload only —
 *     not the start byte, length, or stop byte.
 *
 * A single BLE notification is not a packet here either — same resync
 * discipline as `UbxRingBuffer`: hunt for a valid start byte, and on any
 * length/CRC mismatch, drop one byte and try again rather than discarding
 * everything buffered.
 */

const START_SHORT = 0x02;
const START_LONG = 0x03;
const STOP = 0x03;
const MAX_SHORT_PAYLOAD = 255;
const MAX_LONG_PAYLOAD = 65_535;

/** CRC-16/XMODEM: poly 0x1021, init 0x0000, no reflection — computed over `bytes` only. */
export function vescCrc16(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Frame `payload` as a short VESC packet, ready to write to the NUS TX characteristic. */
export function encodeVescPacket(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_SHORT_PAYLOAD) {
    throw new Error(`VESC payload too long for a short packet: ${payload.length} bytes`);
  }
  const crc = vescCrc16(payload);
  const out = new Uint8Array(1 + 1 + payload.length + 2 + 1);
  let i = 0;
  out[i++] = START_SHORT;
  out[i++] = payload.length;
  out.set(payload, i);
  i += payload.length;
  out[i++] = (crc >> 8) & 0xff;
  out[i++] = crc & 0xff;
  out[i] = STOP;
  return out;
}

export class VescPacketReader {
  private buf: number[] = [];

  /** Feed bytes in; get every complete, CRC-valid payload extractable so far. */
  push(chunk: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array[] {
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : new Uint8Array(chunk);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    return this.drain();
  }

  private drain(): Uint8Array[] {
    const out: Uint8Array[] = [];
    let i = 0;

    while (i < this.buf.length) {
      const start = this.buf[i];
      if (start !== START_SHORT && start !== START_LONG) {
        i++;
        continue;
      }

      const lenBytes = start === START_SHORT ? 1 : 2;
      const headerSize = 1 + lenBytes;
      if (i + headerSize > this.buf.length) break; // wait for more

      const length = lenBytes === 1
        ? this.buf[i + 1]
        : (this.buf[i + 1] << 8) | this.buf[i + 2];
      const maxLen = start === START_SHORT ? MAX_SHORT_PAYLOAD : MAX_LONG_PAYLOAD;
      if (length > maxLen) {
        i++;
        continue;
      }

      const packetSize = headerSize + length + 2 /* crc */ + 1 /* stop */;
      if (i + packetSize > this.buf.length) break; // wait for the rest

      const asBytes = Uint8Array.from(this.buf);
      const payloadStart = i + headerSize;
      const payload = asBytes.slice(payloadStart, payloadStart + length);
      const crcHi = this.buf[payloadStart + length];
      const crcLo = this.buf[payloadStart + length + 1];
      const stopByte = this.buf[payloadStart + length + 2];
      const wantCrc = vescCrc16(payload);

      if (stopByte !== STOP || ((crcHi << 8) | crcLo) !== wantCrc) {
        i++;
        continue;
      }

      out.push(payload);
      i += packetSize;
    }

    if (i > 0) this.buf.splice(0, i);
    return out;
  }

  get pendingBytes(): number {
    return this.buf.length;
  }

  reset(): void {
    this.buf.length = 0;
  }
}
