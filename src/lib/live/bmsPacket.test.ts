import { describe, it, expect } from 'vitest';
import { buildBmsRequest, BmsPacketReader } from './bmsPacket';
import { COMM_BASIC_INFO, COMM_CELL_VOLTAGES } from './bmsDecoder';

// A real COMM_BASIC_INFO response captured live from a "SP17S005P17S20A" JBD
// BMS — start/stop/checksum included, exactly what BmsPacketReader receives
// as BLE notification bytes (split across two chunks, matching how the real
// device actually delivered it over a 20-byte-MTU connection).
const REAL_BASIC_INFO_CHUNK_1 = new Uint8Array([
  0xdd, 0x03, 0x00, 0x26, 0x12, 0x96, 0x01, 0xfb, 0x07, 0xd0, 0x07, 0xd0, 0x00, 0x00, 0x30, 0x54,
  0x00, 0x00, 0x00, 0x00,
]);
const REAL_BASIC_INFO_CHUNK_2 = new Uint8Array([
  0x00, 0x00, 0x38, 0x64, 0x03, 0x0c, 0x03, 0x0b, 0xf5, 0x0b, 0xc7, 0x0b, 0xc4, 0x00, 0x00, 0x00,
  0x07, 0xd0, 0x07, 0xd0,
]);
const REAL_BASIC_INFO_CHUNK_3 = new Uint8Array([0x00, 0x00, 0xf7, 0x07, 0x77]);

describe('buildBmsRequest', () => {
  it('frames a bare read request: start, request marker, cmd, len=0, checksum, stop', () => {
    const req = buildBmsRequest(COMM_BASIC_INFO);
    expect(Array.from(req)).toEqual([0xdd, 0xa5, 0x03, 0x00, 0xff, 0xfd, 0x77]);
  });

  it('produces a different checksum for a different command', () => {
    const req = buildBmsRequest(COMM_CELL_VOLTAGES);
    expect(Array.from(req)).toEqual([0xdd, 0xa5, 0x04, 0x00, 0xff, 0xfc, 0x77]);
  });
});

describe('BmsPacketReader', () => {
  it('reassembles a real response split across multiple BLE notifications', () => {
    const reader = new BmsPacketReader();
    expect(reader.push(REAL_BASIC_INFO_CHUNK_1)).toHaveLength(0);
    expect(reader.push(REAL_BASIC_INFO_CHUNK_2)).toHaveLength(0);
    const out = reader.push(REAL_BASIC_INFO_CHUNK_3);
    expect(out).toHaveLength(1);
    expect(out[0].cmd).toBe(COMM_BASIC_INFO);
    expect(out[0].status).toBe(0);
    expect(out[0].data).toHaveLength(38);
    expect(reader.pendingBytes).toBe(0);
  });

  it('extracts a whole frame delivered in one chunk', () => {
    const reader = new BmsPacketReader();
    const whole = new Uint8Array([
      ...REAL_BASIC_INFO_CHUNK_1, ...REAL_BASIC_INFO_CHUNK_2, ...REAL_BASIC_INFO_CHUNK_3,
    ]);
    const out = reader.push(whole);
    expect(out).toHaveLength(1);
    expect(out[0].data[0]).toBe(0x12); // first data byte (voltage hi)
  });

  it('resyncs past garbage bytes preceding a valid frame', () => {
    const reader = new BmsPacketReader();
    const whole = new Uint8Array([
      0xff, 0xee, 0xaa, ...REAL_BASIC_INFO_CHUNK_1, ...REAL_BASIC_INFO_CHUNK_2, ...REAL_BASIC_INFO_CHUNK_3,
    ]);
    const out = reader.push(whole);
    expect(out).toHaveLength(1);
    expect(out[0].cmd).toBe(COMM_BASIC_INFO);
  });

  it('drops a frame with a corrupted checksum and does not emit it', () => {
    const reader = new BmsPacketReader();
    const corrupted = Uint8Array.from(REAL_BASIC_INFO_CHUNK_1);
    corrupted[5] ^= 0xff; // flip a data byte without fixing the checksum
    const out = reader.push(new Uint8Array([...corrupted, ...REAL_BASIC_INFO_CHUNK_2, ...REAL_BASIC_INFO_CHUNK_3]));
    expect(out).toHaveLength(0);
  });

  it('extracts two back-to-back frames from one chunk', () => {
    const reader = new BmsPacketReader();
    const cellVoltages = new Uint8Array([
      0xdd, 0x04, 0x00, 0x02, 0x0f, 0x7b, 0xff, 0x74, 0x77,
    ]);
    const whole = new Uint8Array([
      ...REAL_BASIC_INFO_CHUNK_1, ...REAL_BASIC_INFO_CHUNK_2, ...REAL_BASIC_INFO_CHUNK_3,
      ...cellVoltages,
    ]);
    const out = reader.push(whole);
    expect(out).toHaveLength(2);
    expect(out[0].cmd).toBe(COMM_BASIC_INFO);
    expect(out[1].cmd).toBe(COMM_CELL_VOLTAGES);
    expect(Array.from(out[1].data)).toEqual([0x0f, 0x7b]);
  });

  it('reset() clears buffered bytes', () => {
    const reader = new BmsPacketReader();
    reader.push(REAL_BASIC_INFO_CHUNK_1); // partial, waiting for more
    expect(reader.pendingBytes).toBeGreaterThan(0);
    reader.reset();
    expect(reader.pendingBytes).toBe(0);
  });
});
