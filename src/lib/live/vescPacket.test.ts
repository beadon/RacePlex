import { describe, it, expect } from 'vitest';
import { vescCrc16, encodeVescPacket, VescPacketReader } from './vescPacket';

describe('vescCrc16', () => {
  it('is 0 for an empty payload', () => {
    expect(vescCrc16(new Uint8Array([]))).toBe(0);
  });

  it('matches the CRC-16/XMODEM reference check value for "123456789"', () => {
    // poly 0x1021, init 0x0000, no reflection, no final XOR — this is the
    // XMODEM parameterization, not CCITT-FALSE (which inits at 0xFFFF)
    // despite sharing a polynomial; VESC firmware's crc16() uses init 0.
    const bytes = new TextEncoder().encode('123456789');
    expect(vescCrc16(bytes)).toBe(0x31c3);
  });
});

describe('encodeVescPacket', () => {
  it('frames a short packet: start, length, payload, crc16 (big-endian), stop', () => {
    const payload = new Uint8Array([4]); // COMM_GET_VALUES
    const framed = encodeVescPacket(payload);
    const crc = vescCrc16(payload);
    expect(Array.from(framed)).toEqual([
      0x02, 1, 4, (crc >> 8) & 0xff, crc & 0xff, 0x03,
    ]);
  });

  it('throws for a payload too long for a short packet', () => {
    expect(() => encodeVescPacket(new Uint8Array(256))).toThrow();
  });
});

describe('VescPacketReader', () => {
  it('extracts a single packet delivered whole', () => {
    const payload = new Uint8Array([4, 1, 2, 3]);
    const reader = new VescPacketReader();
    const out = reader.push(encodeVescPacket(payload));
    expect(out).toHaveLength(1);
    expect(Array.from(out[0])).toEqual(Array.from(payload));
    expect(reader.pendingBytes).toBe(0);
  });

  it('reassembles a packet split across multiple BLE notifications', () => {
    const payload = new Uint8Array([4, 9, 9, 9, 9]);
    const framed = encodeVescPacket(payload);
    const reader = new VescPacketReader();

    expect(reader.push(framed.slice(0, 3))).toHaveLength(0);
    expect(reader.pendingBytes).toBe(3);
    const out = reader.push(framed.slice(3));
    expect(out).toHaveLength(1);
    expect(Array.from(out[0])).toEqual(Array.from(payload));
  });

  it('resyncs past garbage bytes preceding a valid packet', () => {
    const payload = new Uint8Array([4, 5]);
    const framed = encodeVescPacket(payload);
    const withGarbage = new Uint8Array([0xff, 0xee, 0xaa, ...framed]);
    const reader = new VescPacketReader();
    const out = reader.push(withGarbage);
    expect(out).toHaveLength(1);
    expect(Array.from(out[0])).toEqual(Array.from(payload));
  });

  it('drops a packet with a corrupted CRC and does not emit it', () => {
    const payload = new Uint8Array([4, 5, 6]);
    const framed = encodeVescPacket(payload);
    framed[framed.length - 3] ^= 0xff; // flip a CRC byte
    const reader = new VescPacketReader();
    expect(reader.push(framed)).toHaveLength(0);
  });

  it('extracts two back-to-back packets from one chunk', () => {
    const a = encodeVescPacket(new Uint8Array([1]));
    const b = encodeVescPacket(new Uint8Array([2, 2]));
    const reader = new VescPacketReader();
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    const out = reader.push(combined);
    expect(out).toHaveLength(2);
    expect(Array.from(out[0])).toEqual([1]);
    expect(Array.from(out[1])).toEqual([2, 2]);
  });

  it('reset() clears buffered bytes', () => {
    const reader = new VescPacketReader();
    reader.push(new Uint8Array([0x02, 5, 1, 2, 3])); // partial, waiting for more
    expect(reader.pendingBytes).toBeGreaterThan(0);
    reader.reset();
    expect(reader.pendingBytes).toBe(0);
  });
});
