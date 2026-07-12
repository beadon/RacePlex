import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  courseFromDeviceLaps,
  detectSpeedUnit,
  isRaceBoxCsvFormat,
  parseRaceBoxCsvFile,
} from './raceboxCsvParser';
import { parseDatalogContent } from './datalogParser';
import { calculateLaps } from './lapCalculation';
import { MPS_TO_KPH, haversineDistance, speedTriple } from './parserUtils';
import { GpsSample } from '@/types/racing';

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

/**
 * The CSV has no waypoints, so the only record of where the timing lines were is the device's own
 * `Lap` column: it says WHEN the device thought a line was crossed, and the GPS columns say WHERE.
 *
 * The real fixture is point-to-point and single-run, so the circuit path is exercised with a
 * synthetic ride round a circle instead.
 */
describe('courseFromDeviceLaps', () => {
  const M_PER_DEG_LAT = 111_320;
  const CENTER = { lat: 40, lon: -105 };
  const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);

  const sample = (t: number, lat: number, lon: number, lap?: number): GpsSample => ({
    t,
    lat,
    lon,
    ...speedTriple(30),
    extraFields: lap === undefined ? {} : { 'Device Lap': lap },
  });

  /**
   * Three laps of a 100 m-radius circle at 2° per 100 ms — one lap every 18.0 s — after most of an
   * out-lap. The device's lap counter ticks over each time the rider passes due east of the centre
   * (angle 0), which is therefore where the start/finish line must land.
   *
   * The tail deliberately drops back to lap 0 in the middle of a corner, which is what leaving the
   * track looks like: nowhere near a timing line, and emphatically not a finish line.
   */
  const circuitRide = (): GpsSample[] => {
    const out: GpsSample[] = [];
    for (let deg = -60, i = 0; deg < 1000; deg += 2, i++) {
      const rad = (deg * Math.PI) / 180;
      const lap = deg < 0 ? 0 : Math.floor(deg / 360) + 1;
      out.push(
        sample(
          i * 100,
          CENTER.lat + (100 * Math.sin(rad)) / M_PER_DEG_LAT,
          CENTER.lon + (100 * Math.cos(rad)) / M_PER_DEG_LON,
          deg >= 940 ? 0 : lap, // rider peels off mid-corner and the counter resets
        ),
      );
    }
    return out;
  };

  it('puts the start/finish line where the lap counter ticked over', () => {
    const course = courseFromDeviceLaps(circuitRide(), 'Circle')!;

    expect(course).not.toBeNull();
    const mid = {
      lat: (course.startFinishA.lat + course.startFinishB.lat) / 2,
      lon: (course.startFinishA.lon + course.startFinishB.lon) / 2,
    };
    // Angle 0 = due east of the centre. Samples are 3.5 m apart there, so the midpoint estimate
    // cannot be more than a couple of metres out.
    const eastPoint = { lat: CENTER.lat, lon: CENTER.lon + 100 / M_PER_DEG_LON };
    expect(haversineDistance(mid.lat, mid.lon, eastPoint.lat, eastPoint.lon)).toBeLessThan(4);
  });

  it('calls a multi-lap session a circuit, and does not invent a finish line where the rider left the track', () => {
    const course = courseFromDeviceLaps(circuitRide(), 'Circle')!;

    // The lap number climbing 1→2→3 with no return to 0 in between is the signature of one line
    // crossed repeatedly. The single trailing drop to 0 is the rider going home.
    expect(course.finishA).toBeUndefined();
    expect(course.finishB).toBeUndefined();
  });

  it('times the circuit laps the rider actually did', () => {
    const laps = calculateLaps(circuitRide(), courseFromDeviceLaps(circuitRide(), 'Circle')!);

    // Three crossings of the line (laps 1, 2 and 3 beginning) bound two complete laps.
    expect(laps).toHaveLength(2);
    for (const lap of laps) expect(lap.lapTimeMs).toBeCloseTo(18_000, -2);
  });

  it('reads a point-to-point course out of a single timed run', () => {
    // Due north at 10 m/s: start line at 100 m, finish at 300 m, so the run must take 20.0 s.
    const ride = Array.from({ length: 500 }, (_, i) => {
      const metres = i * 1;
      const lap = metres >= 100 && metres < 300 ? 1 : 0;
      return sample(i * 100, CENTER.lat + metres / M_PER_DEG_LAT, CENTER.lon, lap);
    });

    const course = courseFromDeviceLaps(ride, 'Hill run')!;
    expect(course.finishA).toBeDefined();

    const laps = calculateLaps(ride, course);
    expect(laps).toHaveLength(1);
    expect(laps[0].lapTimeMs).toBeCloseTo(20_000, -2);
  });

  it('returns nothing when the file has no Lap column', () => {
    const ride = Array.from({ length: 100 }, (_, i) =>
      sample(i * 100, CENTER.lat + i / M_PER_DEG_LAT, CENTER.lon),
    );
    expect(courseFromDeviceLaps(ride, 'x')).toBeNull();
  });

  it('returns nothing when the rider never armed a run (Lap is all zeros)', () => {
    const ride = Array.from({ length: 100 }, (_, i) =>
      sample(i * 100, CENTER.lat + i / M_PER_DEG_LAT, CENTER.lon, 0),
    );
    expect(courseFromDeviceLaps(ride, 'x')).toBeNull();
  });

  it('returns nothing for the out-lap portion of the real session', () => {
    // Real data, sliced before the rider ever crossed the start line: the Lap column is all zeros
    // and there is nothing to reconstruct. Must not fabricate a course out of it.
    const outLap = parseRaceBoxCsvFile(realCsv).samples.filter(
      (s) => s.extraFields['Device Lap'] === 0,
    );
    expect(outLap.length).toBeGreaterThan(100);
    expect(courseFromDeviceLaps(outLap, 'x')).toBeNull();
  });

  it('returns nothing for a log that begins mid-run', () => {
    // Lap 1 from the first sample, then a drop to 0: we saw the finish but never the start, so we
    // have no idea where the start line is. Guessing one would fabricate a lap time.
    const ride = Array.from({ length: 100 }, (_, i) =>
      sample(i * 100, CENTER.lat + i / M_PER_DEG_LAT, CENTER.lon, i < 50 ? 1 : 0),
    );
    expect(courseFromDeviceLaps(ride, 'x')).toBeNull();
  });

  it('returns nothing when the device changed lap while the rider was stationary', () => {
    // No movement means no heading, and a timing line laid on a heading of pure GPS noise points
    // in an arbitrary direction.
    const parked = Array.from({ length: 100 }, (_, i) =>
      sample(i * 100, CENTER.lat, CENTER.lon, i < 50 ? 0 : 1),
    );
    expect(courseFromDeviceLaps(parked, 'x')).toBeNull();
  });
});

describe('parseRaceBoxCsvFile — embedded course', () => {
  it('hands the reconstructed course out with the parsed data', () => {
    expect(parseRaceBoxCsvFile(realCsv).embeddedCourse?.finishA).toBeDefined();
  });

  it('parses a Lap-less export without inventing one', () => {
    // Not every RaceBox preset emits a Lap column. Those files simply have no course in them, and
    // the rider is asked to pick one — exactly as before.
    const csv = [
      'Time,Latitude,Longitude,Speed',
      ...Array.from(
        { length: 60 },
        (_, i) => `${i * 0.1},${40 + i / 111_320},-105,36`,
      ),
    ].join('\n');

    const parsed = parseRaceBoxCsvFile(csv);
    expect(parsed.samples).toHaveLength(60);
    expect(parsed.embeddedCourse).toBeUndefined();
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
