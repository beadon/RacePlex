import { describe, it, expect } from 'vitest';
import {
  deriveFix,
  averageHz,
  bestSpeedMps,
  bestHeading,
  toTimingSample,
  type GeoFix,
} from './gpsTestMetrics';

function fix(partial: Partial<GeoFix> & Pick<GeoFix, 't' | 'lat' | 'lon'>): GeoFix {
  return {
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    ...partial,
  };
}

describe('deriveFix', () => {
  it('returns nulls for the first fix (no previous)', () => {
    const d = deriveFix(null, fix({ t: 1000, lat: 0, lon: 0 }));
    expect(d).toEqual({
      dtSec: null,
      instantHz: null,
      distanceM: null,
      derivedSpeedMps: null,
      derivedHeading: null,
    });
  });

  it('computes dt, Hz, distance, speed and heading between two fixes', () => {
    // ~0.001 deg of latitude ≈ 111 m; moving due north over 1 s.
    const prev = fix({ t: 0, lat: 45, lon: 0 });
    const cur = fix({ t: 1000, lat: 45.001, lon: 0 });
    const d = deriveFix(prev, cur);
    expect(d.dtSec).toBe(1);
    expect(d.instantHz).toBe(1);
    expect(d.distanceM).toBeGreaterThan(100);
    expect(d.distanceM).toBeLessThan(120);
    expect(d.derivedSpeedMps).toBeCloseTo(d.distanceM!, 5);
    // Due north ≈ 0° bearing.
    expect(d.derivedHeading).toBeCloseTo(0, 1);
  });

  it('guards a zero-gap duplicate callback (no Infinity)', () => {
    const prev = fix({ t: 1000, lat: 1, lon: 1 });
    const cur = fix({ t: 1000, lat: 1.0001, lon: 1 });
    const d = deriveFix(prev, cur);
    expect(d.dtSec).toBe(0);
    expect(d.instantHz).toBeNull();
    expect(d.derivedSpeedMps).toBeNull();
  });

  it('leaves derivedHeading null when the device did not move', () => {
    const prev = fix({ t: 0, lat: 10, lon: 10 });
    const cur = fix({ t: 1000, lat: 10, lon: 10 });
    const d = deriveFix(prev, cur);
    expect(d.distanceM).toBe(0);
    expect(d.derivedHeading).toBeNull();
  });
});

describe('averageHz', () => {
  it('returns null with fewer than two fixes', () => {
    expect(averageHz([])).toBeNull();
    expect(averageHz([{ t: 0 }])).toBeNull();
  });

  it('averages over the timestamp span (5 fixes @ 1 Hz → 1 Hz)', () => {
    const fixes = [0, 1000, 2000, 3000, 4000].map((t) => ({ t }));
    expect(averageHz(fixes)).toBe(1);
  });

  it('only looks at the most recent `window` fixes', () => {
    // First gap is huge (slow), then 4 fast 10 Hz fixes; window=5 ignores the slow gap.
    const fixes = [{ t: 0 }, { t: 100000 }, { t: 100100 }, { t: 100200 }, { t: 100300 }, { t: 100400 }];
    expect(averageHz(fixes, 5)).toBeCloseTo(10, 5);
  });
});

describe('best* fallbacks', () => {
  it('prefers the device speed/heading when present', () => {
    const f = fix({ t: 0, lat: 0, lon: 0, speed: 12, heading: 90 });
    const d = deriveFix(null, f);
    expect(bestSpeedMps(f, d)).toBe(12);
    expect(bestHeading(f, d)).toBe(90);
  });

  it('falls back to derived speed/heading when the device omits them', () => {
    const prev = fix({ t: 0, lat: 45, lon: 0 });
    const cur = fix({ t: 1000, lat: 45.001, lon: 0 });
    const d = deriveFix(prev, cur);
    expect(bestSpeedMps(cur, d)).toBe(d.derivedSpeedMps);
    expect(bestHeading(cur, d)).toBe(d.derivedHeading);
  });

  it('ignores a negative device speed', () => {
    const f = fix({ t: 0, lat: 0, lon: 0, speed: -1 });
    const d = deriveFix(null, f);
    expect(bestSpeedMps(f, d)).toBeNull();
  });
});

describe('toTimingSample', () => {
  it('rebases time to the session start and fills all speed units', () => {
    const prev = fix({ t: 10000, lat: 45, lon: 0 });
    const cur = fix({ t: 11000, lat: 45.001, lon: 0 });
    const d = deriveFix(prev, cur);
    const s = toTimingSample(cur, d, 10000);
    expect(s.t).toBe(1000);
    expect(s.lat).toBe(45.001);
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.236936, 5);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 5);
  });

  it('emits zero speed (never NaN) when no speed is available', () => {
    const f = fix({ t: 5000, lat: 1, lon: 1 });
    const s = toTimingSample(f, deriveFix(null, f), 5000);
    expect(s.speedMps).toBe(0);
    expect(s.t).toBe(0);
  });
});
