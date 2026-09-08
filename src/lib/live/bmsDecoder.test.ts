import { describe, it, expect } from 'vitest';
import {
  COMM_BASIC_INFO,
  COMM_CELL_VOLTAGES,
  COMM_DEVICE_NAME,
  buildBasicInfoRequest,
  buildCellVoltagesRequest,
  buildDeviceNameRequest,
  decodeBasicInfo,
  decodeCellVoltages,
  decodeDeviceName,
} from './bmsDecoder';

// Real COMM_BASIC_INFO response `data` payload (framing already stripped —
// this is what BmsPacketReader.push() hands the decoder), captured live from
// a "SP17S005P17S20A" JBD BMS. Every field below was cross-checked against
// the vendor app's own RT Data screen for the same board at the same moment:
// 47.58V / 5.07A / 100% SOC / 12 cells / MOS 33.0°C, matching what the app
// displayed (see docs/plans for the full writeup).
const REAL_BASIC_INFO_DATA = new Uint8Array([
  0x12, 0x96, 0x01, 0xfb, 0x07, 0xd0, 0x07, 0xd0, 0x00, 0x00, 0x30, 0x54, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x38, 0x64, 0x03, 0x0c, 0x03, 0x0b, 0xf5, 0x0b, 0xc7, 0x0b, 0xc4, 0x00, 0x00, 0x00,
  0x07, 0xd0, 0x07, 0xd0, 0x00, 0x00,
]);

// Real COMM_CELL_VOLTAGES response `data` payload from the same board/moment
// — 12 cells, ~3.96V each, summing consistently with the 47.58V pack total.
const REAL_CELL_VOLTAGES_DATA = new Uint8Array([
  0x0f, 0x7b, 0x0f, 0x7d, 0x0f, 0x80, 0x0f, 0x7f, 0x0f, 0x7d, 0x0f, 0x7d,
  0x0f, 0x7c, 0x0f, 0x7c, 0x0f, 0x7f, 0x0f, 0x7a, 0x0f, 0x7b, 0x0f, 0x7b,
]);

// Real COMM_DEVICE_NAME response `data` payload — matches the vendor app's
// own "Bluetooth name" / "Device model" field exactly.
const REAL_DEVICE_NAME_DATA = new Uint8Array([
  0x53, 0x50, 0x31, 0x37, 0x53, 0x30, 0x30, 0x35, 0x50, 0x31, 0x37, 0x53, 0x32, 0x30, 0x41,
]);

describe('request builders', () => {
  it('build a single-command-byte request for each command', () => {
    expect(Array.from(buildBasicInfoRequest())).toEqual([0xdd, 0xa5, COMM_BASIC_INFO, 0x00, 0xff, 0xfd, 0x77]);
    expect(Array.from(buildCellVoltagesRequest())).toEqual([0xdd, 0xa5, COMM_CELL_VOLTAGES, 0x00, 0xff, 0xfc, 0x77]);
    expect(Array.from(buildDeviceNameRequest())).toEqual([0xdd, 0xa5, COMM_DEVICE_NAME, 0x00, 0xff, 0xfb, 0x77]);
  });
});

describe('decodeBasicInfo', () => {
  it('decodes every field correctly from a real hardware capture', () => {
    const v = decodeBasicInfo(REAL_BASIC_INFO_DATA);
    expect(v).not.toBeNull();
    expect(v!.voltageV).toBeCloseTo(47.58, 2);
    expect(v!.currentA).toBeCloseTo(5.07, 2);
    expect(v!.remainAh).toBeCloseTo(20.0, 2);
    expect(v!.nominalAh).toBeCloseTo(20.0, 2);
    expect(v!.cycles).toBe(0);
    expect(v!.socPct).toBe(100);
    expect(v!.chargeFetOn).toBe(true);
    expect(v!.dischargeFetOn).toBe(true);
    expect(v!.numCells).toBe(12);
    expect(v!.numTemps).toBe(3);
    expect(v!.tempsC[0]).toBeCloseTo(33.0, 1); // MOSFET sensor — confirmed via the vendor app's "MOS" label
    expect(v!.tempsC[1]).toBeCloseTo(28.4, 1);
    expect(v!.tempsC[2]).toBeCloseTo(28.1, 1);
    expect(v!.protectionStatus).toBe(0);
    expect(v!.balanceStatus).toBe(0);
  });

  it('returns null for a payload shorter than the guaranteed fields', () => {
    expect(decodeBasicInfo(REAL_BASIC_INFO_DATA.slice(0, 10))).toBeNull();
  });

  it('stops adding temps once the payload runs out, without throwing', () => {
    // Cut off partway through the second temperature reading.
    const short = REAL_BASIC_INFO_DATA.slice(0, 26);
    const v = decodeBasicInfo(short);
    expect(v).not.toBeNull();
    expect(v!.numTemps).toBe(3); // still reports what the header says
    expect(v!.tempsC).toHaveLength(1); // but only got as far as the data allows
  });

  it('decodes a negative current as regen/charging in the opposite direction', () => {
    const negative = Uint8Array.from(REAL_BASIC_INFO_DATA);
    const view = new DataView(negative.buffer);
    view.setInt16(2, -507, false);
    const v = decodeBasicInfo(negative);
    expect(v!.currentA).toBeCloseTo(-5.07, 2);
  });
});

describe('decodeCellVoltages', () => {
  it('decodes all 12 cells correctly from a real hardware capture', () => {
    const v = decodeCellVoltages(REAL_CELL_VOLTAGES_DATA);
    expect(v).not.toBeNull();
    expect(v!.cellsV).toHaveLength(12);
    expect(v!.cellsV[0]).toBeCloseTo(3.963, 3);
    expect(v!.highV).toBeCloseTo(3.968, 3);
    expect(v!.lowV).toBeCloseTo(3.962, 3);
    expect(v!.diffV).toBeCloseTo(0.006, 3);
    expect(v!.avgV).toBeGreaterThan(v!.lowV);
    expect(v!.avgV).toBeLessThan(v!.highV);
    // Cross-check: 12 cells averaging ~3.965V sums to the pack's own 47.58V reading.
    expect(v!.avgV * 12).toBeCloseTo(47.58, 0);
  });

  it('returns null for an empty payload', () => {
    expect(decodeCellVoltages(new Uint8Array([]))).toBeNull();
  });

  it('returns null for an odd-length payload', () => {
    expect(decodeCellVoltages(new Uint8Array([0x0f, 0x7b, 0x00]))).toBeNull();
  });
});

describe('decodeDeviceName', () => {
  it('decodes the device name/model string from a real hardware capture', () => {
    expect(decodeDeviceName(REAL_DEVICE_NAME_DATA)).toBe('SP17S005P17S20A');
  });

  it('returns null for an empty payload', () => {
    expect(decodeDeviceName(new Uint8Array([]))).toBeNull();
  });
});
