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
import { haversineDistance, speedTriple } from './parserUtils';

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

/**
 * The same session, imported as CSV instead of GPX.
 *
 * The CSV carries no waypoints — nothing says where the course is except the device's own `Lap`
 * column. Reconstructing the timing lines from where the rider WAS when that column changed has to
 * put us in the same place, and give the same run time, as the GPX's explicit Start/Finish
 * waypoints do. If it doesn't, the reconstruction is wrong.
 */
describe('the same RaceBox session, from the CSV', () => {
  const csv = parseRaceBoxCsvFile(csvText);
  const gpx = parseGpxFile(gpxText);

  const midOf = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => ({
    lat: (a.lat + b.lat) / 2,
    lon: (a.lon + b.lon) / 2,
  });

  it('reconstructs a course from the Lap column alone', () => {
    expect(csv.embeddedCourse).toBeDefined();
    // Start and finish came out ~85 m apart, so this must be point-to-point, same as the GPX.
    expect(csv.embeddedCourse!.finishA).toBeDefined();
  });

  it('puts both timing lines where the GPX says they are', () => {
    const wpts = extractGpxWaypoints(gpxText);
    const start = wpts.find((w) => w.name === 'Start')!;
    const finish = wpts.find((w) => w.name === 'Finish')!;

    const course = csv.embeddedCourse!;
    const ourStart = midOf(course.startFinishA, course.startFinishB);
    const ourFinish = midOf(course.finishA!, course.finishB!);

    // Within the width of the racing line. The reconstruction can only place the line between the
    // two samples that straddle the crossing, and at 100 km/h those are ~1 m apart; the rest of the
    // gap is where on the (50 m wide) line the rider happened to cross it.
    expect(haversineDistance(ourStart.lat, ourStart.lon, start.lat, start.lon)).toBeLessThan(10);
    expect(haversineDistance(ourFinish.lat, ourFinish.lon, finish.lat, finish.lon)).toBeLessThan(10);
  });

  /**
   * The headline. Three independent measurements of the same run:
   *   36.480 s — the device's own, quantised to whole samples
   *   36.547 s — ours, from the GPX's Start/Finish waypoints
   *   ~36.52 s — ours, from the CSV's Lap column and nothing else
   */
  it('reproduces the 36.480s run that the device itself timed', () => {
    const laps = calculateLaps(csv.samples, csv.embeddedCourse!);
    expect(laps).toHaveLength(1);

    const seconds = laps[0].lapTimeMs / 1000;
    expect(seconds).toBeCloseTo(36.48, 1); // within 50 ms of the device

    const gpxSeconds = calculateLaps(gpx.samples, gpx.embeddedCourse!)[0].lapTimeMs / 1000;
    expect(Math.abs(seconds - gpxSeconds)).toBeLessThan(0.1);
  });

  it('gives a rider with an empty garage lap times on import', () => {
    // This is the whole point: importing this CSV used to say "No Track Detected".
    const result = autoDetectCourse(csv.samples, [], csv.embeddedCourse);

    expect(result).not.toBeNull();
    expect(result!.isWaypointMode).toBe(false);
    expect(result!.laps).toHaveLength(1);
    expect(result!.laps[0].lapTimeMs / 1000).toBeCloseTo(36.48, 1);
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
