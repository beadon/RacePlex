import { describe, it, expect } from 'vitest';
import {
  serializeRplx,
  serializeRplxBlob,
  buildRplxFileName,
  formatRplxDatetime,
  RPLX_EXTENSION,
} from './rplxWriter';
import { GpsFixQuality } from './gpsFix';
import type { GpsObservation } from './customGps';
import { isDovexFormat, parseDovexFile } from '@/lib/dovexParser';
import { MPS_TO_MPH } from '@/lib/parserUtils';

const BASE_TS = 1_700_000_000_000; // a valid ms timestamp in the parser's range

function makeObs(i: number, over: Partial<{ lat: number; lon: number; speedMps: number; course: number | null; altitude: number | null; accuracy: number }> = {}): GpsObservation {
  const lat = over.lat ?? 45 + i * 0.0001;
  const lon = over.lon ?? -73 + i * 0.0001;
  return {
    fix: {
      seq: i,
      timestamp: BASE_TS + i * 1_000,
      lat,
      lon,
      altitude: over.altitude === undefined ? 100 + i : over.altitude,
      accuracy: over.accuracy ?? 4,
      altitudeAccuracy: null,
      speed: null,
      heading: null,
      quality: GpsFixQuality.Good,
    },
    motion: {
      dtSec: 1,
      instantHz: 1,
      distanceM: 10,
      speedMps: over.speedMps ?? 20,
      speedSource: 'derived',
      course: over.course === undefined ? 90 : over.course,
      courseSource: 'derived',
    },
    elapsedMs: i * 1_000,
    averageHz: 1,
  };
}

describe('rplx filename + datetime', () => {
  it('formats a device-style filename with the .rplx extension', () => {
    const name = buildRplxFileName(new Date(2026, 5, 14, 9, 5).getTime()); // 2026-06-14 09:05 local
    expect(name).toBe('20260614_0905.rplx');
    expect(name.endsWith(`.${RPLX_EXTENSION}`)).toBe(true);
  });

  it('formats the preamble datetime', () => {
    expect(formatRplxDatetime(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02 03:04:05');
  });
});

describe('serializeRplx — dovex-compatible round trip', () => {
  const observations = [makeObs(0), makeObs(1), makeObs(2), makeObs(3)];
  const meta = { driver: 'Tester', course: 'Full CW', shortName: 'OKC', bestLapMs: 62345, optimalMs: 61200, lapTimesMs: [65432, 62345] };

  it('produces content the .dovex detector + parser accept', () => {
    const content = serializeRplx(observations, meta);
    expect(isDovexFormat(content)).toBe(true);
    const parsed = parseDovexFile(content);
    expect(parsed.samples).toHaveLength(observations.length);
  });

  it('round-trips position and speed through the parser', () => {
    const content = serializeRplx(observations, meta);
    const parsed = parseDovexFile(content);
    const first = parsed.samples[0];
    expect(first.lat).toBeCloseTo(observations[0].fix.lat, 6);
    expect(first.lon).toBeCloseTo(observations[0].fix.lon, 6);
    // speed: mps → mph (write, 2dp) → mps (parse) recovers the original within
    // the 2-decimal mph storage precision.
    expect(first.speedMph).toBeCloseTo(20 * MPS_TO_MPH, 1);
    expect(first.speedMps).toBeCloseTo(20, 1);
  });

  it('carries session metadata into dovexMetadata', () => {
    const content = serializeRplx(observations, meta);
    const parsed = parseDovexFile(content);
    expect(parsed.dovexMetadata?.driver).toBe('Tester');
    expect(parsed.dovexMetadata?.course).toBe('Full CW');
    expect(parsed.dovexMetadata?.shortName).toBe('OKC');
    expect(parsed.dovexMetadata?.bestLapMs).toBe(62345);
    expect(parsed.dovexMetadata?.optimalMs).toBe(61200);
    expect(parsed.dovexMetadata?.lapTimesMs).toEqual([65432, 62345]);
  });

  it('does not fabricate channels the phone lacks (no sats/hdop/rpm/accel)', () => {
    const content = serializeRplx(observations, meta);
    const header = content.split('\n').find((l) => l.startsWith('timestamp'))!;
    expect(header).toBe('timestamp,lat,lng,speed_mph,altitude_m,heading_deg,h_acc_m');
  });

  it('leaves null altitude/heading blank without breaking the parse', () => {
    const obs = [
      makeObs(0, { altitude: null, course: null }),
      makeObs(1, { altitude: null, course: null }),
    ];
    const content = serializeRplx(obs);
    const parsed = parseDovexFile(content);
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[1].lat).toBeCloseTo(obs[1].fix.lat, 6);
    // altitude is blank → never fabricated as 0 in extraFields
    expect(parsed.samples[0].extraFields.Altitude).toBeUndefined();
  });

  it('serializes to a text/csv Blob', () => {
    const blob = serializeRplxBlob(observations, meta);
    expect(blob.type).toBe('text/csv');
    expect(blob.size).toBeGreaterThan(0);
  });
});
