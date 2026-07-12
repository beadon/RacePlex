import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  courseFromGpxWaypoints,
  extractGpxWaypoints,
  isGpxFormat,
  parseGpxFile,
} from './gpxParser';
import { parseDatalogContent } from './datalogParser';
import { haversineDistance } from './parserUtils';

const realGpx = readFileSync(resolve(__dirname, '__fixtures__/racebox-session.gpx'), 'utf-8');
const realCsv = readFileSync(resolve(__dirname, '__fixtures__/racebox-session.csv'), 'utf-8');

describe('isGpxFormat', () => {
  it('accepts a real RaceBox GPX', () => {
    expect(isGpxFormat(realGpx)).toBe(true);
  });

  it('rejects other XML', () => {
    expect(isGpxFormat('<?xml version="1.0"?><kml><Document/></kml>')).toBe(false);
  });

  it('rejects CSV', () => {
    expect(isGpxFormat('Record,Time,Latitude\n1,2,3')).toBe(false);
  });
});

describe('parseGpxFile — real RaceBox GPX', () => {
  const parsed = parseGpxFile(realGpx);

  /**
   * The file splits the ride across four <trkseg>s. They are one continuous ride, and all 3628
   * points must survive — treating each segment as its own session would fragment the lap.
   */
  it('concatenates all four track segments', () => {
    expect(parsed.samples).toHaveLength(3628);
  });

  it('reads position, elevation and satellites', () => {
    expect(parsed.samples[0].lat).toBeCloseTo(33.6528145, 6);
    expect(parsed.samples[0].lon).toBeCloseTo(-117.3042013, 6);
    expect(parsed.samples[0].extraFields['Altitude (m)']).toBeCloseTo(390.6, 1);
    // RaceBox writes <siv>, not the standard <sat>.
    expect(parsed.samples[1].extraFields['Satellites']).toBe(28);
  });

  it('starts at t=0', () => {
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.startDate?.toISOString()).toBe('2026-06-21T20:43:33.000Z');
  });

  /**
   * GPX carries no speed channel at all, so it must be differentiated from position. A rider who
   * hit ~100 km/h in this session must show up as having moved.
   */
  it('derives speed from position, since GPX has no speed channel', () => {
    const maxKph = Math.max(...parsed.samples.map((s) => s.speedKph));
    expect(maxKph).toBeGreaterThan(80);
    expect(maxKph).toBeLessThan(120);
    expect(parsed.samples.every((s) => Number.isFinite(s.speedMps) && s.speedMps >= 0)).toBe(true);
  });

  it('smooths the derived speed enough to be usable', () => {
    // Unsmoothed 25 Hz GPS differentiation swings wildly sample-to-sample. Check that consecutive
    // speeds don't imply absurd acceleration (>3g) once smoothed.
    let worst = 0;
    for (let i = 1; i < parsed.samples.length; i++) {
      const dt = (parsed.samples[i].t - parsed.samples[i - 1].t) / 1000;
      if (dt <= 0) continue;
      const dv = Math.abs(parsed.samples[i].speedMps - parsed.samples[i - 1].speedMps);
      worst = Math.max(worst, dv / dt);
    }
    expect(worst).toBeLessThan(3 * 9.80665);
  });
});

describe('GPX and CSV exports of the same session agree', () => {
  // The two files describe the same ride. Cross-validating them catches an error in either parser
  // that a single-format test could never see.
  it('places the rider in the same spot at the same moment', () => {
    const gpx = parseGpxFile(realGpx);
    const csv = parseDatalogContent(realCsv);

    expect(gpx.samples).toHaveLength(csv.samples.length);

    // The two exports differ by a constant ~160 ms in absolute time but describe identical
    // positions in the same order, so compare positionally.
    for (const i of [0, 500, 1500, 3000, 3627]) {
      const d = haversineDistance(
        gpx.samples[i].lat,
        gpx.samples[i].lon,
        csv.samples[i].lat,
        csv.samples[i].lon,
      );
      expect(d).toBeLessThan(0.5); // metres
    }
  });

  it('derives a speed from GPX close to the one RaceBox reported in the CSV', () => {
    const gpx = parseGpxFile(realGpx);
    const csv = parseDatalogContent(realCsv);

    // Compare only while genuinely moving; at a standstill the derived speed is GPS jitter.
    const diffs: number[] = [];
    for (let i = 0; i < gpx.samples.length; i++) {
      if (csv.samples[i].speedMps < 5) continue;
      diffs.push(Math.abs(gpx.samples[i].speedMps - csv.samples[i].speedMps));
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    expect(mean).toBeLessThan(1.5); // m/s — smoothing costs a little, but they track each other
  });
});

describe('extractGpxWaypoints', () => {
  it('finds the Start and Finish timing waypoints', () => {
    const wpts = extractGpxWaypoints(realGpx);
    expect(wpts).toHaveLength(2);
    expect(wpts[0].name).toBe('Start');
    expect(wpts[0].lat).toBeCloseTo(33.6526160, 6);
    expect(wpts[1].name).toBe('Finish');
    expect(wpts[1].lat).toBeCloseTo(33.6518577, 6);
  });

  it('does not mistake trackpoints for waypoints', () => {
    // <trkpt> and <wpt> both carry lat/lon; a sloppy regex grabs 3628 of them.
    expect(extractGpxWaypoints(realGpx)).toHaveLength(2);
  });
});

describe('courseFromGpxWaypoints', () => {
  const parsed = parseGpxFile(realGpx);
  const waypoints = extractGpxWaypoints(realGpx);

  it('reconstructs a timing line from a bare waypoint, so lap timing needs no setup', () => {
    const course = courseFromGpxWaypoints(waypoints, parsed.samples, 'Test', 50);
    expect(course).not.toBeNull();

    // The line must straddle the waypoint: ~50 m long, centred on it.
    const width = haversineDistance(
      course!.startFinishA.lat,
      course!.startFinishA.lon,
      course!.startFinishB.lat,
      course!.startFinishB.lon,
    );
    expect(width).toBeCloseTo(50, 0);

    const start = waypoints[0];
    const midLat = (course!.startFinishA.lat + course!.startFinishB.lat) / 2;
    const midLon = (course!.startFinishA.lon + course!.startFinishB.lon) / 2;
    expect(haversineDistance(start.lat, start.lon, midLat, midLon)).toBeLessThan(1);
  });

  it('lays the line across the direction of travel, not along it', () => {
    // A timing line parallel to the rider's path would never be crossed. The line's own bearing
    // must be roughly perpendicular (90 deg) to the direction the rider passes through it.
    const course = courseFromGpxWaypoints(waypoints, parsed.samples, 'Test', 50)!;

    const start = waypoints[0];
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < parsed.samples.length; i++) {
      const d = haversineDistance(start.lat, start.lon, parsed.samples[i].lat, parsed.samples[i].lon);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }

    const bearingOf = (aLat: number, aLon: number, bLat: number, bLon: number) => {
      const dLon = ((bLon - aLon) * Math.PI) / 180;
      const y = Math.sin(dLon) * Math.cos((bLat * Math.PI) / 180);
      const x =
        Math.cos((aLat * Math.PI) / 180) * Math.sin((bLat * Math.PI) / 180) -
        Math.sin((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.cos(dLon);
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    };

    const travel = bearingOf(
      parsed.samples[nearest - 2].lat,
      parsed.samples[nearest - 2].lon,
      parsed.samples[nearest + 2].lat,
      parsed.samples[nearest + 2].lon,
    );
    const line = bearingOf(
      course.startFinishA.lat,
      course.startFinishA.lon,
      course.startFinishB.lat,
      course.startFinishB.lon,
    );

    let delta = Math.abs(travel - line) % 360;
    if (delta > 180) delta = 360 - delta;
    expect(Math.abs(delta - 90)).toBeLessThan(5);
  });

  it('returns null when the file has no timing waypoints', () => {
    expect(courseFromGpxWaypoints([], parsed.samples, 'Test')).toBeNull();
    expect(
      courseFromGpxWaypoints([{ lat: 33.6, lon: -117.3, name: 'Parking' }], parsed.samples, 'T'),
    ).toBeNull();
  });
});

describe('dispatch', () => {
  it('routes a GPX through parseDatalogContent', () => {
    const parsed = parseDatalogContent(realGpx);
    expect(parsed.samples).toHaveLength(3628);
  });
});
