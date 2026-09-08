import { describe, it, expect } from 'vitest';
import {
  COMM_GET_VALUES,
  COMM_GET_VALUES_SETUP,
  buildGetValuesRequest,
  buildGetValuesSetupRequest,
  decodeGetValues,
  decodeGetValuesSetup,
} from './vescDecoder';

/**
 * Build a synthetic `COMM_GET_VALUES` response matching VESC firmware's own
 * serialization order (`comm/commands.c`), so the test fixture is the wire
 * format itself, not a description of it.
 */
function buildGetValuesResponse(values: {
  tempEscC?: number;
  tempMotorC?: number;
  motorCurrentA?: number;
  batteryCurrentA?: number;
  dutyCycle?: number;
  erpm?: number;
  batteryVoltageV?: number;
  ampHours?: number;
  faultCode?: number;
  /** Truncate the buffer right after amp-hours, before the optional tail (fault code etc.). */
  omitTail?: boolean;
}): Uint8Array {
  const {
    tempEscC = 45.2, tempMotorC = 38.1, motorCurrentA = 12.34, batteryCurrentA = 8.5,
    dutyCycle = 0.42, erpm = 12_345, batteryVoltageV = 41.6, ampHours = 1.2345,
    faultCode = 0, omitTail = false,
  } = values;

  const bytes: number[] = [COMM_GET_VALUES];
  const push16 = (v: number) => { bytes.push((v >> 8) & 0xff, v & 0xff); };
  const push32 = (v: number) => { bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); };

  push16(Math.round(tempEscC * 1e1));
  push16(Math.round(tempMotorC * 1e1));
  push32(Math.round(motorCurrentA * 1e2));
  push32(Math.round(batteryCurrentA * 1e2));
  push32(0); // id current
  push32(0); // iq current
  push16(Math.round(dutyCycle * 1e3));
  push32(Math.round(erpm));
  push16(Math.round(batteryVoltageV * 1e1));
  push32(Math.round(ampHours * 1e4));

  if (!omitTail) {
    push32(0); // amp-hours charged
    push32(0); // watt-hours
    push32(0); // watt-hours charged
    push32(0); // tachometer
    push32(0); // tachometer abs
    bytes.push(faultCode & 0xff);
  }

  return new Uint8Array(bytes);
}

describe('buildGetValuesRequest', () => {
  it('is a single COMM_GET_VALUES command byte', () => {
    expect(Array.from(buildGetValuesRequest())).toEqual([COMM_GET_VALUES]);
  });
});

describe('decodeGetValues', () => {
  it('decodes every field with the right scale applied', () => {
    const payload = buildGetValuesResponse({
      tempEscC: 45.2, tempMotorC: 38.1, motorCurrentA: 12.34, batteryCurrentA: 8.5,
      dutyCycle: 0.42, erpm: 12_345, batteryVoltageV: 41.6, ampHours: 1.2345, faultCode: 3,
    });
    const v = decodeGetValues(payload);
    expect(v).not.toBeNull();
    expect(v!.tempEscC).toBeCloseTo(45.2, 1);
    expect(v!.tempMotorC).toBeCloseTo(38.1, 1);
    expect(v!.motorCurrentA).toBeCloseTo(12.34, 2);
    expect(v!.batteryCurrentA).toBeCloseTo(8.5, 2);
    expect(v!.dutyCycle).toBeCloseTo(0.42, 3);
    expect(v!.erpm).toBe(12_345);
    expect(v!.batteryVoltageV).toBeCloseTo(41.6, 1);
    expect(v!.ampHours).toBeCloseTo(1.2345, 4);
    expect(v!.faultCode).toBe(3);
  });

  it('decodes a negative battery current (regen braking)', () => {
    const v = decodeGetValues(buildGetValuesResponse({ batteryCurrentA: -6.75 }));
    expect(v!.batteryCurrentA).toBeCloseTo(-6.75, 2);
  });

  it('defaults faultCode to 0 when the optional tail is missing (older firmware/bridge)', () => {
    const v = decodeGetValues(buildGetValuesResponse({ omitTail: true }));
    expect(v).not.toBeNull();
    expect(v!.faultCode).toBe(0);
    expect(v!.ampHours).toBeCloseTo(1.2345, 4);
  });

  it('returns null for a non-GET_VALUES command id', () => {
    const payload = buildGetValuesResponse({});
    payload[0] = 99;
    expect(decodeGetValues(payload)).toBeNull();
  });

  it('returns null rather than guessing at a truncated payload', () => {
    const short = buildGetValuesResponse({ omitTail: true }).slice(0, 10);
    expect(decodeGetValues(short)).toBeNull();
  });
});

describe('buildGetValuesSetupRequest', () => {
  it('is a single COMM_GET_VALUES_SETUP command byte', () => {
    expect(Array.from(buildGetValuesSetupRequest())).toEqual([COMM_GET_VALUES_SETUP]);
  });
});

describe('decodeGetValuesSetup', () => {
  // A real COMM_GET_VALUES_SETUP response captured live from a "BKB XENITH
  // BLE" board (see docs/plans/0022-vesc-rt-gauge-dashboard.md). This is the
  // actual payload bytes — start/length/crc/stop stripped, matching what
  // VescPacketReader hands the decoder — not a synthetic fixture, because
  // this exact field order was only confirmed by decoding real hardware
  // data and checking it against what VESC Tool showed on screen for the
  // same board at the same moment (ESC 31.9°C, motor 27.2°C, 45.4V, 47.2%
  // battery, odometer 780.93 mi — all matched what the app displayed).
  const REAL_CAPTURE = new Uint8Array([
    0x2f, 0x01, 0x3f, 0x01, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xc6, 0x01,
    0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xf3, 0x00, 0x00, 0x00, 0x1a, 0x10,
    0xd8, 0x22, 0x40, 0x00, 0x6d, 0x02, 0x00, 0x36, 0xda, 0x2e, 0x00, 0x13, 0x2d,
    0x4b, 0x00, 0x09, 0x58, 0x01,
  ]);

  it('decodes every field correctly from a real hardware capture', () => {
    const v = decodeGetValuesSetup(REAL_CAPTURE);
    expect(v).not.toBeNull();
    expect(v!.tempEscC).toBeCloseTo(31.9, 1);
    expect(v!.tempMotorC).toBeCloseTo(27.2, 1);
    expect(v!.motorCurrentA).toBeCloseTo(0, 2);
    expect(v!.batteryCurrentA).toBeCloseTo(0, 2);
    expect(v!.dutyCycle).toBeCloseTo(0, 3);
    expect(v!.erpm).toBe(0);
    expect(v!.speedMps).toBeCloseTo(0, 3);
    expect(v!.batteryVoltageV).toBeCloseTo(45.4, 1);
    expect(v!.batteryLevel).toBeCloseTo(0.472, 3);
    expect(v!.wattHours).toBeCloseTo(0, 4);
    expect(v!.faultCode).toBe(0);
    expect(v!.numVescs).toBe(2);
    // The headline result: this is what confirmed the field offsets were
    // right at all — VESC Tool showed "780.9" for this exact board.
    expect(v!.odometerMeters).toBeCloseTo(1_256_779, 0);
    expect(v!.odometerMeters! / 1609.344).toBeCloseTo(780.93, 1);
    expect(v!.uptimeMs).toBe(612_353);
  });

  it('returns null for a non-GET_VALUES_SETUP command id', () => {
    const wrongId = new Uint8Array(REAL_CAPTURE);
    wrongId[0] = 4;
    expect(decodeGetValuesSetup(wrongId)).toBeNull();
  });

  it('returns null for a payload shorter than the guaranteed front fields', () => {
    expect(decodeGetValuesSetup(REAL_CAPTURE.slice(0, 10))).toBeNull();
  });

  it('degrades gracefully when trailing fields are missing, rather than failing outright', () => {
    // Cut right after battery_level (the guaranteed-present front section) —
    // an older/leaner firmware might not send amp-hours through uptime at all.
    const short = REAL_CAPTURE.slice(0, 27);
    const v = decodeGetValuesSetup(short);
    expect(v).not.toBeNull();
    expect(v!.batteryVoltageV).toBeCloseTo(45.4, 1);
    expect(v!.tripMeters).toBe(0);
    expect(v!.odometerMeters).toBeUndefined();
    expect(v!.uptimeMs).toBeUndefined();
    expect(v!.numVescs).toBeUndefined();
  });

  it('stops at whichever optional field the payload was truncated before, leaving the rest undefined', () => {
    // Cut partway through the trip/odometer section, before fault code.
    const short = REAL_CAPTURE.slice(0, 43);
    const v = decodeGetValuesSetup(short);
    expect(v).not.toBeNull();
    expect(v!.ampHours).toBeCloseTo(0, 4);
    expect(v!.tripMeters).toBe(0); // never reached — truncated before the tachometer field
    expect(v!.faultCode).toBe(0);
    expect(v!.odometerMeters).toBeUndefined();
  });
});
