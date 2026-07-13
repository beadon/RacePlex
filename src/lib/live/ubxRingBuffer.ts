/**
 * UBX frame ring buffer (issue #32).
 *
 * Both RaceBox and Dragy speak UBX-framed packets over Bluetooth LE
 * notifications. A single BLE notification is NOT a packet — the vendor's
 * own doc is emphatic about this: a notification may carry a partial packet,
 * several packets, or both, and the transport layer is free to fragment on
 * any byte boundary. So bytes go into a ring buffer, and we resync + validate
 * every packet before handing it up.
 *
 * ### Framing (`docs/ble-protocol.md` mirrors this):
 *
 *     B5 62 | class(1) | id(1) | length(2, LE) | payload | CK_A CK_B
 *
 *   - Sync bytes: `B5 62` (0xB5, 0x62).
 *   - Length is little-endian, describes payload only.
 *   - Checksum (8-bit Fletcher) is computed over class..payload inclusive.
 *   - Any resync failure DROPS a single byte and tries again — a corrupt
 *     packet is not fatal, just discarded.
 *
 * This module is pure: no BLE, no timers, no I/O. Feed it bytes with `push`,
 * read complete packets from the returned array. Safe to call from a worker,
 * a test, or the main thread.
 */

const SYNC_1 = 0xb5;
const SYNC_2 = 0x62;
const HEADER_SIZE = 6; // sync(2) + class + id + length(2)
const CHECKSUM_SIZE = 2;
const MAX_PAYLOAD = 65_535; // 16-bit length field cap

export interface UbxPacket {
  /** UBX message class. */
  cls: number;
  /** UBX message id (unique within `cls`). */
  id: number;
  /** Payload bytes, `length` from the header. Zero-copy view over the ring. */
  payload: Uint8Array;
}

/**
 * Compute the UBX 8-bit Fletcher checksum over a byte range.
 * The range is class..end-of-payload — NOT including the sync bytes or the
 * checksum itself. Exported for tests + the encoder path (if ever added).
 */
export function ubxChecksum(bytes: Uint8Array, start: number, end: number): [number, number] {
  let a = 0;
  let b = 0;
  for (let i = start; i < end; i++) {
    a = (a + bytes[i]) & 0xff;
    b = (b + a) & 0xff;
  }
  return [a, b];
}

export class UbxRingBuffer {
  /**
   * Backing store. Grows in chunks; we could implement a circular one, but a
   * simple growing array + head cursor is simpler and every packet is a few
   * hundred bytes at most.
   */
  private buf: number[] = [];

  /**
   * Feed a chunk of bytes into the buffer and return every complete packet
   * that can now be extracted. Resyncs past corruption by dropping bytes
   * one at a time until a valid sync-word + length + checksum is found.
   *
   * A packet larger than `MAX_PAYLOAD` is a sync error — the length field
   * is 16-bit, so anything above 65535 is corrupt. We drop the sync bytes
   * and try again.
   */
  push(chunk: ArrayBuffer | ArrayBufferView | Uint8Array): UbxPacket[] {
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : new Uint8Array(chunk);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    return this.drain();
  }

  /** Every complete packet that can be extracted right now. */
  private drain(): UbxPacket[] {
    const out: UbxPacket[] = [];
    // We use a single index that advances through `this.buf`, then splice off
    // the consumed prefix once we're done — one memory move per drain instead
    // of one per byte.
    let i = 0;

    while (i + HEADER_SIZE <= this.buf.length) {
      // Resync: fast-forward until we see the sync-word.
      if (this.buf[i] !== SYNC_1 || this.buf[i + 1] !== SYNC_2) {
        i++;
        continue;
      }

      // Enough for the header? If not, wait for more bytes.
      if (i + HEADER_SIZE > this.buf.length) break;

      const cls = this.buf[i + 2];
      const id = this.buf[i + 3];
      const length = this.buf[i + 4] | (this.buf[i + 5] << 8);

      if (length > MAX_PAYLOAD) {
        // Impossible length: not a real packet. Drop the sync bytes and
        // hunt for the next candidate.
        i++;
        continue;
      }

      const packetSize = HEADER_SIZE + length + CHECKSUM_SIZE;
      if (i + packetSize > this.buf.length) break; // wait for the rest

      // Validate checksum over class..end-of-payload.
      const asBytes = Uint8Array.from(this.buf);
      const [ca, cb] = ubxChecksum(asBytes, i + 2, i + HEADER_SIZE + length);
      const wantA = this.buf[i + HEADER_SIZE + length];
      const wantB = this.buf[i + HEADER_SIZE + length + 1];
      if (ca !== wantA || cb !== wantB) {
        // Corrupt packet. Drop just the leading sync byte and try again —
        // the real packet may start one byte in.
        i++;
        continue;
      }

      out.push({
        cls,
        id,
        payload: asBytes.slice(i + HEADER_SIZE, i + HEADER_SIZE + length),
      });
      i += packetSize;
    }

    // Discard everything up to `i`. Anything after is either a partial packet
    // (wait for more bytes) or resync noise (will be retried on next push).
    if (i > 0) this.buf.splice(0, i);
    return out;
  }

  /** Bytes buffered but not yet turned into packets. Useful for tests. */
  get pendingBytes(): number {
    return this.buf.length;
  }

  /** Discard everything. */
  reset(): void {
    this.buf.length = 0;
  }
}
