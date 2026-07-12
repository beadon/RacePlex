import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  detectSpeedUnit,
  isRaceBoxCsvFormat,
  parseRaceBoxCsvFile,
} from './raceboxCsvParser';
import { parseDatalogContent } from './datalogParser';
import { MPS_TO_KPH, haversineDistance } from './parserUtils';

const realCsv = readFileSync(resolve(__dirname, '__fixtures__/racebox-session.csv'), 'utf-8');

describe('isRaceBoxCsvFormat', () => {
  it('accepts a real RaceBox export that has no metadata block', () => {
    expect(isRaceBoxCsvFormat(realCsv)).toBe(true);
  });

  it('accepts an export with the Format,RaceBox metadata header', () => {
    expect(
      isRaceBoxCsvFormat('Format,RaceBox CSV\nTrack,Alastaro\n\nRecord,Time,Latitude\n'),
    ).toBe(true);
  });

  it('rejects unrelated CSV', () => {
    expect(isRaceBoxCsvFormat('name,email\nalice,a@b.c\n')).toBe(false);
  });

  it('rejects a plain GPS CSV with no Lap/G-force columns', () => {
    expect(isRaceBoxCsvFormat('Time,Latitude,Longitude\n1,2,3\n')).toBe(false);
  });
});

describe('parseRaceBoxCsvFile — real RaceBox export', () => {
  const parsed = parseRaceBoxCsvFile(realCsv);

  it('parses every data row', () => {
    expect(parsed.samples).toHaveLength(3628);
  });

  it('starts at t=0 and runs the full session duration', () => {
    expect(parsed.samples[0].t).toBe(0);
    // 20:43:33.160Z -> 20:46:04.400Z
    expect(parsed.duration).toBeCloseTo(151_240, -1);
  });

  it('reads the wall-clock start date from the ISO time column', () => {
    expect(parsed.startDate?.toISOString()).toBe('2026-06-21T20:43:33.160Z');
  });

  it('reads coordinates', () => {
    expect(parsed.samples[0].lat).toBeCloseTo(33.6528145, 6);
    expect(parsed.samples[0].lon).toBeCloseTo(-117.3042013, 6);
  });

  /**
   * The headline test.
   *
   * RaceBox writes a bare `Speed` header regardless of whether the user exported m/s, kph or mph.
   * If we assumed m/s here, every speed in the app would be 3.6x too high — and would still look
   * completely plausible. So the parser measures the column against the positions.
   *
   * Row 1 reports Speed=3.41. If that were m/s the rider would be doing 12 km/h; it is in fact
   * 3.41 km/h, i.e. 0.947 m/s.
   */
  it('detects that the unitless Speed column is kph, and converts it to m/s', () => {
    expect(parsed.samples[0].speedKph).toBeCloseTo(3.41, 2);
    expect(parsed.samples[0].speedMps).toBeCloseTo(3.41 / MPS_TO_KPH, 3);
  });

  it('agrees with speed derived independently from the positions', () => {
    // Cross-check the converted speed against ground speed computed from lat/lon deltas. If the
    // unit were misread, this ratio would come out at 3.6 (or 1/3.6) instead of ~1.
    const ratios: number[] = [];
    for (let i = 1; i < parsed.samples.length; i++) {
      const a = parsed.samples[i - 1];
      const b = parsed.samples[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const derived = haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt;
      if (derived < 2 || b.speedMps < 2) continue;
      ratios.push(b.speedMps / derived);
    }
    ratios.sort((x, y) => x - y);
    const median = ratios[Math.floor(ratios.length / 2)];
    expect(median).toBeGreaterThan(0.9);
    expect(median).toBeLessThan(1.1);
  });

  it('keeps the gyro channels that the cloud exporter does not emit', () => {
    expect(parsed.samples[0].extraFields['Gyro X']).toBeCloseTo(0.48, 2);
    expect(parsed.samples[0].extraFields['Gyro Z']).toBeCloseTo(-0.36, 2);
    expect(parsed.fieldMappings.some((f) => f.name === 'Gyro X')).toBe(true);
  });

  it('keeps G-force and altitude', () => {
    expect(parsed.samples[0].extraFields['Vert G (Native)']).toBeCloseTo(1.001, 3);
    expect(parsed.samples[0].extraFields['Altitude (m)']).toBeCloseTo(390.6, 1);
  });

  /**
   * RaceBox's own Lap column is ground truth from the device: it marks exactly one timed run,
   * of 36.480 s, between its Start and Finish lines. We preserve it so our own lap detection can
   * be checked against it.
   */
  it('preserves the device lap numbering as ground truth', () => {
    const laps = parsed.samples.map((s) => s.extraFields['Device Lap']);
    expect(new Set(laps)).toEqual(new Set([0, 1]));

    const timed = parsed.samples.filter((s) => s.extraFields['Device Lap'] === 1);
    const durationSec = (timed[timed.length - 1].t - timed[0].t) / 1000;
    expect(durationSec).toBeCloseTo(36.48, 1);
  });
});

describe('detectSpeedUnit', () => {
  // A synthetic ride heading due north at a constant 10 m/s, sampled at 10 Hz. At that speed each
  // 100 ms step covers 1 m, which is ~9e-6 degrees of latitude.
  const METRE_IN_DEG_LAT = 1 / 111_320;
  const rows = (factor: number) =>
    Array.from({ length: 200 }, (_, i) => ({
      timeMs: i * 100,
      lat: 40 + i * METRE_IN_DEG_LAT,
      lon: -105,
      reportedSpeed: 10 * factor,
      cells: [] as string[],
    }));

  it('identifies m/s', () => {
    expect(detectSpeedUnit(rows(1))).toBe('mps');
  });

  it('identifies kph', () => {
    expect(detectSpeedUnit(rows(3.6))).toBe('kph');
  });

  it('identifies mph', () => {
    expect(detectSpeedUnit(rows(2.23694))).toBe('mph');
  });

  it('identifies knots', () => {
    expect(detectSpeedUnit(rows(1.94384))).toBe('knots');
  });

  it('refuses to guess when the column is not a ground speed at all', () => {
    // e.g. someone points us at an RPM column: ~50x the true speed, matching no unit.
    expect(detectSpeedUnit(rows(50))).toBeNull();
  });

  it('refuses to guess from a stationary log', () => {
    const parked = Array.from({ length: 200 }, (_, i) => ({
      timeMs: i * 100,
      lat: 40,
      lon: -105,
      reportedSpeed: 0,
      cells: [] as string[],
    }));
    expect(detectSpeedUnit(parked)).toBeNull();
  });
});

describe('dispatch', () => {
  it('routes a RaceBox CSV through parseDatalogContent', () => {
    const parsed = parseDatalogContent(realCsv);
    expect(parsed.samples).toHaveLength(3628);
    expect(parsed.samples[0].speedKph).toBeCloseTo(3.41, 1);
  });
});
