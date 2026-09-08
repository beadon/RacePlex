/**
 * JBD (Jiabaida) BMS packet framing (issue #73) — the protocol the same
 * chips sold as "Xiaoxiang" / "Smart BMS" / "Little Elephant" speak over
 * their BLE UART bridge. Community-reverse-engineered, not vendor-published,
 * but verified byte-for-byte against a real unit (see `bmsDecoder.test.ts`'s
 * golden fixtures) — not guesswork.
 *
 * Request frame (host → BMS):
 *
 *     0xDD | 0xA5 | cmd(1) | len(1, always 0 here — every request we send is
 *     a bare read, no payload) | crc16(2, big-endian) | 0x77
 *
 *   Checksum covers `cmd + len + data` (data is empty for every request this
 *   module builds).
 *
 * Response frame (BMS → host):
 *
 *     0xDD | cmd(1, echoed) | status(1, 0x00 = ok) | len(1) | data(len) |
 *     crc16(2, big-endian) | 0x77
 *
 *   Checksum covers `len + data` only — **not** the echoed cmd or status
 *   byte, confirmed against a real capture (a checksum computed including
 *   `cmd` does not match; excluding it does). This differs from the request
 *   side, which does include its own second byte (`cmd`) in the sum — the
 *   two directions are asymmetric, not a copy-paste of the same formula.
 *
 * A single BLE notification is not a frame — same resync discipline as
 * `VescPacketReader`/`UbxRingBuffer`: hunt for `0xDD`, and on any
 * length/checksum mismatch, drop one byte and try again.
 */

const START = 0xdd;
const STOP = 0x77;
const REQUEST_MARKER = 0xa5;
const MAX_PAYLOAD = 255;

function checksum(sumOfBytes: number): number {
  return (0x10000 - sumOfBytes) & 0xffff;
}

/** Build a bare (no-payload) read request for `cmd`. */
export function buildBmsRequest(cmd: number): Uint8Array {
  const len = 0;
  const crc = checksum(cmd + len);
  return new Uint8Array([START, REQUEST_MARKER, cmd, len, (crc >> 8) & 0xff, crc & 0xff, STOP]);
}

export interface BmsResponseFrame {
  cmd: number;
  status: number;
  data: Uint8Array;
}

export class BmsPacketReader {
  private buf: number[] = [];

  /** Feed bytes in; get every complete, checksum-valid response frame extractable so far. */
  push(chunk: ArrayBuffer | ArrayBufferView | Uint8Array): BmsResponseFrame[] {
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : new Uint8Array(chunk);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    return this.drain();
  }

  private drain(): BmsResponseFrame[] {
    const out: BmsResponseFrame[] = [];
    let i = 0;

    while (i < this.buf.length) {
      if (this.buf[i] !== START) {
        i++;
        continue;
      }
      const headerSize = 4; // start, cmd, status, len
      if (i + headerSize > this.buf.length) break; // wait for more

      const cmd = this.buf[i + 1];
      const status = this.buf[i + 2];
      const len = this.buf[i + 3];
      if (len > MAX_PAYLOAD) {
        i++;
        continue;
      }

      const frameSize = headerSize + len + 2 /* crc */ + 1 /* stop */;
      if (i + frameSize > this.buf.length) break; // wait for the rest

      const asBytes = Uint8Array.from(this.buf);
      const dataStart = i + headerSize;
      const data = asBytes.slice(dataStart, dataStart + len);
      const crcHi = this.buf[dataStart + len];
      const crcLo = this.buf[dataStart + len + 1];
      const stopByte = this.buf[dataStart + len + 2];

      let sum = len;
      for (const b of data) sum += b;
      const wantCrc = checksum(sum);

      if (stopByte !== STOP || ((crcHi << 8) | crcLo) !== wantCrc) {
        i++;
        continue;
      }

      out.push({ cmd, status, data });
      i += frameSize;
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
