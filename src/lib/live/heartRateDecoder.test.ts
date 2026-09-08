import { describe, it, expect } from 'vitest';
import { decodeHeartRateMeasurement } from './heartRateDecoder';

describe('decodeHeartRateMeasurement', () => {
  it('decodes a plain u8 BPM value with no optional fields', () => {
    const s = decodeHeartRateMeasurement(new Uint8Array([0x00, 72]));
    expect(s).toEqual({ bpm: 72, rrIntervalMs: undefined, contactDetected: undefined });
  });

  it('decodes a u16 BPM value with sensor contact detected and a single RR-interval', () => {
    // flags: u16(0x01) | contact-detected(0x02) | contact-supported(0x04) | RR-present(0x10) = 0x17
    // bpm 310 = 0x0136 (little-endian: 0x36, 0x01); RR 1024 (=1000ms) = 0x0400 (little-endian: 0x00, 0x04)
    const s = decodeHeartRateMeasurement(new Uint8Array([0x17, 0x36, 0x01, 0x00, 0x04]));
    expect(s).toEqual({ bpm: 310, rrIntervalMs: 1000, contactDetected: true });
  });

  it('keeps only the most recent RR-interval when a notification batches more than one', () => {
    // flags: u8 format | RR-present(0x10) = 0x10; RR values 512 (500ms) then 2048 (2000ms)
    const s = decodeHeartRateMeasurement(new Uint8Array([0x10, 80, 0x00, 0x02, 0x00, 0x08]));
    expect(s?.bpm).toBe(80);
    expect(s?.rrIntervalMs).toBe(2000);
  });

  it('skips over Energy Expended to find the fields after it', () => {
    // flags: u8 format | energy-present(0x08) = 0x08; energy 300 = 0x012C (little-endian: 0x2C, 0x01)
    const s = decodeHeartRateMeasurement(new Uint8Array([0x08, 65, 0x2c, 0x01]));
    expect(s).toEqual({ bpm: 65, rrIntervalMs: undefined, contactDetected: undefined });
  });

  it('handles energy and RR both present together with a u16 BPM', () => {
    // flags: u16(0x01) | energy(0x08) | RR(0x10) = 0x19
    // bpm 999 = 0x03E7; energy 500 = 0x01F4; RR 1536 (1500ms) = 0x0600
    const s = decodeHeartRateMeasurement(new Uint8Array([0x19, 0xe7, 0x03, 0xf4, 0x01, 0x00, 0x06]));
    expect(s?.bpm).toBe(999);
    expect(s?.rrIntervalMs).toBe(1500);
  });

  it('reports contactDetected undefined when the device does not support the feature', () => {
    const s = decodeHeartRateMeasurement(new Uint8Array([0x00, 60]));
    expect(s?.contactDetected).toBeUndefined();
  });

  it('reports contactDetected false when supported but not currently in contact', () => {
    // flags: contact-supported(0x04) only, contact-detected bit clear
    const s = decodeHeartRateMeasurement(new Uint8Array([0x04, 60]));
    expect(s?.contactDetected).toBe(false);
  });

  it('returns null for a payload too short to contain a BPM value', () => {
    expect(decodeHeartRateMeasurement(new Uint8Array([]))).toBeNull();
    expect(decodeHeartRateMeasurement(new Uint8Array([0x01, 0x36]))).toBeNull(); // u16 format needs 2 more bytes
  });
});
