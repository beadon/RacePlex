/**
 * Tests for the git-native track collection (plan 0008).
 *
 * The validator's entire job is to stop bad geometry from merging, so most of
 * these assert *rejection*. A validator that only ever passes its happy path is
 * not a validator.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDrawingsJson,
  buildTracksJson,
  haversineMeters,
  lineCrossesLayout,
  polylineLengthMeters,
  segmentsIntersect,
  trackSlug,
} from './tracks-format.mjs';
import { validateCollection, validateTrack } from './tracks-validate.mjs';

const ROOT = join(__dirname, '..');

/** A minimal valid course: a 20 m start line crossing a small square outline. */
function course(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Main',
    lengthFt: 1000,
    // Start line runs E–W across the square's west edge.
    start_a_lat: 30.0,
    start_a_lng: -97.0001,
    start_b_lat: 30.0,
    start_b_lng: -96.9999,
    layout: [
      { lat: 29.9999, lon: -97.0 },
      { lat: 30.0005, lon: -97.0 },
      { lat: 30.0005, lon: -96.999 },
      { lat: 29.9999, lon: -96.999 },
      { lat: 29.9999, lon: -97.0 },
    ],
    ...overrides,
  };
}

function track(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Hill',
    shortName: 'TH',
    defaultCourse: 'Main',
    courses: [course()],
    ...overrides,
  };
}

const FILE = 'test-hill.json';

describe('geometry', () => {
  it('measures a known distance', () => {
    // 0.001° of latitude ≈ 111 m anywhere on Earth.
    expect(haversineMeters({ lat: 30, lon: -97 }, { lat: 30.001, lon: -97 })).toBeCloseTo(111, 0);
  });

  it('sums a polyline', () => {
    const len = polylineLengthMeters([
      { lat: 30, lon: -97 },
      { lat: 30.001, lon: -97 },
      { lat: 30.002, lon: -97 },
    ]);
    expect(len).toBeCloseTo(222, 0);
  });

  it('detects crossing and non-crossing segments', () => {
    const a = { lat: 0, lon: -1 };
    const b = { lat: 0, lon: 1 };
    expect(segmentsIntersect(a, b, { lat: -1, lon: 0 }, { lat: 1, lon: 0 })).toBe(true);
    expect(segmentsIntersect(a, b, { lat: 1, lon: 0 }, { lat: 2, lon: 0 })).toBe(false);
  });

  it('finds a timing line crossing an outline', () => {
    const c = course();
    const line = {
      a: { lat: c.start_a_lat, lon: c.start_a_lng },
      b: { lat: c.start_b_lat, lon: c.start_b_lng },
    };
    expect(lineCrossesLayout(line, c.layout)).toBe(true);
  });
});

describe('trackSlug', () => {
  it('slugifies a track name into its filename', () => {
    expect(trackSlug('Orlando Kart Center')).toBe('orlando-kart-center');
    expect(trackSlug("Rider's Hill (North)")).toBe('rider-s-hill-north');
  });
});

describe('validateTrack', () => {
  it('accepts a well-formed track', () => {
    expect(validateTrack(track(), FILE)).toEqual([]);
  });

  it('rejects a missing name', () => {
    expect(validateTrack(track({ name: '' }), FILE)[0]).toMatch(/missing "name"/);
  });

  it('rejects a filename that does not match the track name', () => {
    expect(validateTrack(track(), 'wrong-name.json')[0]).toMatch(/filename should be "test-hill.json"/);
  });

  it('rejects a shortName over 8 chars', () => {
    expect(validateTrack(track({ shortName: 'WAYTOOLONG' }), FILE)[0]).toMatch(/max is 8/);
  });

  it('rejects a track with no courses', () => {
    expect(validateTrack(track({ courses: [] }), FILE)[0]).toMatch(/at least one course/);
  });

  it('rejects a defaultCourse that names no real course', () => {
    expect(validateTrack(track({ defaultCourse: 'Ghost' }), FILE)[0]).toMatch(/not one of this track's courses/);
  });

  it('rejects duplicate course names', () => {
    const t = track({ courses: [course(), course()] });
    expect(validateTrack(t, FILE).some((p) => /duplicate course "Main"/.test(p))).toBe(true);
  });

  it('rejects an out-of-range latitude', () => {
    const t = track({ courses: [course({ start_a_lat: 91 })] });
    expect(validateTrack(t, FILE).some((p) => /not a valid latitude/.test(p))).toBe(true);
  });

  it('rejects a (0, 0) coordinate as unset', () => {
    const t = track({
      courses: [course({ start_a_lat: 0, start_a_lng: 0, layout: undefined })],
    });
    expect(validateTrack(t, FILE).some((p) => /looks unset/.test(p))).toBe(true);
  });

  // The headline check: a transposed digit produces a line that is still a valid
  // coordinate pair, so only a geometry check can catch it.
  it('rejects a timing line that is implausibly wide', () => {
    const t = track({
      // -96.9999 → -95.9999: one digit, ~96 km of line.
      courses: [course({ start_b_lng: -95.9999, layout: undefined })],
    });
    expect(validateTrack(t, FILE).some((p) => /check for a typo/.test(p))).toBe(true);
  });

  it('rejects a zero-width timing line', () => {
    const t = track({
      courses: [course({ start_b_lat: 30.0, start_b_lng: -97.0001, layout: undefined })],
    });
    expect(validateTrack(t, FILE).some((p) => /same point/.test(p))).toBe(true);
  });

  it('rejects a timing line that misses the drawn outline', () => {
    // Well-formed, in-range, line-sized — and nowhere near the track.
    const t = track({
      courses: [course({ start_a_lat: 30.02, start_b_lat: 30.02 })],
    });
    expect(validateTrack(t, FILE).some((p) => /does not cross the drawn outline/.test(p))).toBe(true);
  });

  it('accepts a course with no outline at all', () => {
    expect(validateTrack(track({ courses: [course({ layout: undefined })] }), FILE)).toEqual([]);
  });

  it('validates sector lines, not just start/finish', () => {
    const t = track({
      courses: [
        course({
          layout: undefined,
          sectors: [{ a_lat: 30.0, a_lng: -97.0001, b_lat: 30.0, b_lng: -95.0, major: true }],
        }),
      ],
    });
    expect(validateTrack(t, FILE).some((p) => /sector 1 is .* wide/.test(p))).toBe(true);
  });

  it('validates legacy sector_2/sector_3 lines', () => {
    const t = track({
      courses: [
        course({
          layout: undefined,
          sector_2_a_lat: 91,
          sector_2_a_lng: -97.0,
          sector_2_b_lat: 30.0,
          sector_2_b_lng: -97.0,
        }),
      ],
    });
    expect(validateTrack(t, FILE).some((p) => /sector 2 has an out-of-range coordinate/.test(p))).toBe(true);
  });
});

describe('validateCollection', () => {
  it('rejects two tracks sharing a name', () => {
    const records = [
      { file: 'test-hill.json', track: track() },
      { file: 'test-hill.json', track: track() },
    ];
    expect(validateCollection(records).some((p) => /duplicate track name/.test(p))).toBe(true);
  });

  // shortName keys drawings.json — a collision silently gives two tracks one outline.
  it('rejects two tracks sharing a shortName', () => {
    const records = [
      { file: 'test-hill.json', track: track() },
      { file: 'other-hill.json', track: track({ name: 'Other Hill', shortName: 'TH' }) },
    ];
    expect(validateCollection(records).some((p) => /duplicate shortName "TH"/.test(p))).toBe(true);
  });
});

describe('build', () => {
  it('emits the public tracks.json shape', () => {
    const json = buildTracksJson([track()]);
    expect(json['Test Hill'].shortName).toBe('TH');
    expect(json['Test Hill'].defaultCourse).toBe('Main');
    expect(json['Test Hill'].courses[0].start_a_lat).toBe(30.0);
    // The inline outline is NOT part of tracks.json — it goes to drawings.json.
    expect(json['Test Hill'].courses[0]).not.toHaveProperty('layout');
  });

  it('keys drawings by SHORTNAME/CourseName', () => {
    expect(Object.keys(buildDrawingsJson([track()]))).toEqual(['TH/Main']);
  });

  it('derives lengthFt from the outline when not given', () => {
    const json = buildTracksJson([track({ courses: [course({ lengthFt: undefined })] })]);
    expect(json['Test Hill'].courses[0].lengthFt).toBeGreaterThan(0);
  });

  it('is deterministic regardless of input order', () => {
    const a = track();
    const b = track({ name: 'Alpha Park', shortName: 'AP' });
    expect(JSON.stringify(buildTracksJson([a, b]))).toBe(JSON.stringify(buildTracksJson([b, a])));
  });
});

// Golden Rule 3b: the real data must survive the real pipeline.
describe('the committed collection', () => {
  const records = readdirSync(join(ROOT, 'tracks'))
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({
      file,
      track: JSON.parse(readFileSync(join(ROOT, 'tracks', file), 'utf8')),
    }));

  it('has at least one track', () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it('validates clean', () => {
    expect(validateCollection(records)).toEqual([]);
  });

  it('regenerates the committed public/tracks.json exactly', () => {
    const built = buildTracksJson(records.map((r) => r.track));
    const committed = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks.json'), 'utf8'));
    expect(built).toEqual(committed);
  });

  it('regenerates the committed public/drawings.json exactly', () => {
    const built = buildDrawingsJson(records.map((r) => r.track));
    const committed = JSON.parse(readFileSync(join(ROOT, 'public', 'drawings.json'), 'utf8'));
    expect(built).toEqual(committed);
  });
});
