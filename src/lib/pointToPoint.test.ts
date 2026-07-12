/**
 * Point-to-point courses, and courses that arrive embedded in the datalog.
 *
 * The anchor for all of this is a real RaceBox export (sample_race_files/): a point-to-point run
 * whose Start and Finish waypoints sit ~85 m apart, and whose own `Lap` column — written by the
 * device, not by us — marks exactly one timed run of 36.480 s. That gives us something rare and
 * valuable: an independently-produced ground truth to check our lap engine against.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { GpsSample } from '@/types/racing';
import { calculateLaps } from './lapCalculation';
import { autoDetectCourse } from './courseDetection';
import { courseFromGpxWaypoints, extractGpxWaypoints, parseGpxFile } from './gpxParser';
import { parseRaceBoxCsvFile } from './raceboxCsvParser';
import { speedTriple } from './parserUtils';

const gpxText = readFileSync(resolve(__dirname, '__fixtures__/racebox-session.gpx'), 'utf-8');
const csvText = readFileSync(resolve(__dirname, '__fixtures__/racebox-session.csv'), 'utf-8');

describe('calculateLaps — point-to-point courses', () => {
  /**
   * A synthetic ride due north at exactly 10 m/s, 10 Hz. Start line at 100 m, finish at 300 m,
   * so the run between them is 200 m and must take exactly 20.0 s. Known answer, hand-computable.
   */
  const M_PER_DEG_LAT = 111_320;
  const straightRide = (): GpsSample[] =>
    Array.from({ length: 500 }, (_, i) => ({
      t: i * 100, // ms
      lat: 40 + (i * 1) / M_PER_DEG_LAT, // 1 m per 100 ms => 10 m/s
      lon: -105,
      ...speedTriple(10),
      extraFields: {},
    }));

  const lineAcross = (metresNorth: number) => {
    const lat = 40 + metresNorth / M_PER_DEG_LAT;
    // 60 m wide, laid east-west across a northbound rider.
    const halfDeg = 30 / (M_PER_DEG_LAT * Math.cos((40 * Math.PI) / 180));
    return { a: { lat, lon: -105 - halfDeg }, b: { lat, lon: -105 + halfDeg } };
  };

  it('times a run from the start line to a separate finish line', () => {
    const start = lineAcross(100);
    const finish = lineAcross(300);

    const laps = calculateLaps(straightRide(), {
      name: 'Hill run',
      startFinishA: start.a,
      startFinishB: start.b,
      finishA: finish.a,
      finishB: finish.b,
    });

    expect(laps).toHaveLength(1);
    // 200 m at 10 m/s = 20.000 s. Crossing times are interpolated between samples, so this is
    // accurate well below the 100 ms sample interval.
    expect(laps[0].lapTimeMs).toBeCloseTo(20_000, -2);
  });

  it('does not emit a run that starts but never finishes', () => {
    // Finish line beyond the end of the ride (the log stops at ~500 m; put it at 900 m).
    const laps = calculateLaps(straightRide(), {
      name: 'Bailed',
      ...(() => {
        const s = lineAcross(100);
        return { startFinishA: s.a, startFinishB: s.b };
      })(),
      ...(() => {
        const f = lineAcross(900);
        return { finishA: f.a, finishB: f.b };
      })(),
    });

    expect(laps).toHaveLength(0);
  });

  it('still treats a course with no finish line as a circuit', () => {
    // Regression guard: every course upstream ships has no finishA/B, and must keep behaving
    // exactly as before — laps bounded by consecutive crossings of the one line.
    const start = lineAcross(100);
    const laps = calculateLaps(straightRide(), {
      name: 'Circuit',
      startFinishA: start.a,
      startFinishB: start.b,
    });
    // A dead-straight ride crosses the single line once, so it completes no circuit lap.
    expect(laps).toHaveLength(0);
  });
});

describe('the real RaceBox session', () => {
  const parsed = parseGpxFile(gpxText);

  it('recognises it as point-to-point, not a circuit', () => {
    const course = courseFromGpxWaypoints(
      extractGpxWaypoints(gpxText),
      parsed.samples,
      'RaceBox',
    );
    expect(course).not.toBeNull();
    // Start and Finish are ~85 m apart, so a distinct finish line must be produced.
    expect(course!.finishA).toBeDefined();
    expect(course!.finishB).toBeDefined();
  });

  it('carries its course along inside the parsed file', () => {
    expect(parsed.embeddedCourse).toBeDefined();
    expect(parsed.embeddedCourse!.finishA).toBeDefined();
  });

  /**
   * The headline: our lap engine, given only the GPX, must independently reproduce the run time
   * that the RaceBox device itself measured — 36.480 s, per its own Lap column in the CSV.
   */
  it('reproduces the 36.480s run that the device itself timed', () => {
    const laps = calculateLaps(parsed.samples, parsed.embeddedCourse!);

    expect(laps).toHaveLength(1);
    expect(laps[0].lapTimeMs / 1000).toBeCloseTo(36.48, 0);

    // And cross-check the device's own ground truth out of the CSV, so this test fails loudly if
    // the fixture is ever swapped for a different session.
    const csv = parseRaceBoxCsvFile(csvText);
    const timed = csv.samples.filter((s) => s.extraFields['Device Lap'] === 1);
    const deviceSeconds = (timed[timed.length - 1].t - timed[0].t) / 1000;
    expect(deviceSeconds).toBeCloseTo(36.48, 1);

    // Our interpolated time should land within a sample interval (40 ms) of the device's, which
    // is quantised to whole samples.
    expect(Math.abs(laps[0].lapTimeMs / 1000 - deviceSeconds)).toBeLessThan(0.5);
  });
});

describe('autoDetectCourse — embedded course', () => {
  const parsed = parseGpxFile(gpxText);

  it('uses the course from the file even when the garage is empty', () => {
    // The exact situation a first-time user is in: no saved tracks at all. Before this, they got
    // "No Track Detected" and no lap times.
    const result = autoDetectCourse(parsed.samples, [], parsed.embeddedCourse);

    expect(result).not.toBeNull();
    expect(result!.isWaypointMode).toBe(false);
    expect(result!.laps).toHaveLength(1);
    expect(result!.laps[0].lapTimeMs / 1000).toBeCloseTo(36.48, 0);
  });

  it('still returns nothing for an empty garage and no embedded course', () => {
    expect(autoDetectCourse(parsed.samples, [])).toBeNull();
  });

  it('ignores an embedded course that produces no laps in this session', () => {
    // A course from somewhere else entirely: a stale course is worse than no course.
    const elsewhere = {
      name: 'Another continent',
      startFinishA: { lat: 51.0, lon: 0.0 },
      startFinishB: { lat: 51.0, lon: 0.001 },
    };
    expect(autoDetectCourse(parsed.samples, [], elsewhere)).toBeNull();
  });
});
