import { describe, it, expect } from 'vitest';
import { COMM_GET_VALUES, buildGetValuesRequest, decodeGetValues } from './vescDecoder';

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
