/**
 * Shared model for the git-native track collection (plan 0008).
 *
 * `tracks/*.json` is the canonical store — one file per track, submitted by pull
 * request. `public/tracks.json` + `public/drawings.json` are generated artifacts.
 * This module is the single place that knows how to go between the two, so the
 * builder and the validator cannot drift apart.
 *
 * Ported from the logic that used to live in the admin UI's Supabase adapter
 * (`buildTracksJson` / `buildDrawingsJson`) and `submissionMaterialize.ts`, which
 * are unreachable in RacePlex — the fork ships no backend.
 */

// ─── Geometry ───────────────────────────────────────────────────────────────

const METERS_TO_FEET = 3.28084;
const EARTH_RADIUS_M = 6371000;

/** Great-circle distance between two {lat, lon} points, in metres. */
export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Total length of a polyline, in metres. */
export function polylineLengthMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Do segments AB and CD intersect? Planar orientation test — fine at track scale,
 * where a few hundred metres of lat/lon is flat to well within our tolerance.
 */
export function segmentsIntersect(a, b, c, d) {
  const cross = (o, p, q) =>
    (p.lon - o.lon) * (q.lat - o.lat) - (p.lat - o.lat) * (q.lon - o.lon);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Does a timing line cross the drawn outline anywhere? */
export function lineCrossesLayout(line, layout) {
  for (let i = 1; i < layout.length; i++) {
    if (segmentsIntersect(line.a, line.b, layout[i - 1], layout[i])) return true;
  }
  return false;
}

// ─── Track record → generated artifacts ─────────────────────────────────────

/** Every timing line on a course: start/finish first, then the sectors in order. */
export function timingLines(course) {
  const lines = [
    {
      label: 'start/finish',
      a: { lat: course.start_a_lat, lon: course.start_a_lng },
      b: { lat: course.start_b_lat, lon: course.start_b_lng },
    },
  ];
  if (Array.isArray(course.sectors)) {
    course.sectors.forEach((s, i) => {
      lines.push({
        label: `sector ${i + 1}`,
        a: { lat: s.a_lat, lon: s.a_lng },
        b: { lat: s.b_lat, lon: s.b_lng },
      });
    });
  }
  // Legacy two-major form, still carried by the tracks inherited from upstream.
  for (const n of [2, 3]) {
    if (course[`sector_${n}_a_lat`] != null) {
      lines.push({
        label: `sector ${n}`,
        a: { lat: course[`sector_${n}_a_lat`], lon: course[`sector_${n}_a_lng`] },
        b: { lat: course[`sector_${n}_b_lat`], lon: course[`sector_${n}_b_lng`] },
      });
    }
  }
  return lines;
}

/**
 * Serialize one course into the `public/tracks.json` course shape.
 *
 * `lengthFt` is the course's own value when set, else derived from the drawn
 * outline — matching what the old admin builder did with `length_ft_override`.
 * Key order is fixed here because the generated file is committed: a stable
 * ordering keeps the diff honest.
 */
function courseToPublicJson(course) {
  const out = {
    name: course.name,
    lengthFt:
      course.lengthFt != null
        ? course.lengthFt
        : Array.isArray(course.layout) && course.layout.length >= 2
          ? Math.round(polylineLengthMeters(course.layout) * METERS_TO_FEET)
          : 0,
    start_a_lat: course.start_a_lat,
    start_a_lng: course.start_a_lng,
    start_b_lat: course.start_b_lat,
    start_b_lng: course.start_b_lng,
  };
  for (const n of [2, 3]) {
    if (course[`sector_${n}_a_lat`] != null) {
      out[`sector_${n}_a_lat`] = course[`sector_${n}_a_lat`];
      out[`sector_${n}_a_lng`] = course[`sector_${n}_a_lng`];
      out[`sector_${n}_b_lat`] = course[`sector_${n}_b_lat`];
      out[`sector_${n}_b_lng`] = course[`sector_${n}_b_lng`];
    }
  }
  if (Array.isArray(course.sectors) && course.sectors.length > 0) {
    out.sectors = course.sectors;
  }
  return out;
}

/**
 * Build `public/tracks.json` from the track records.
 *
 * Tracks are emitted in name order (not directory order) so the artifact is a
 * pure function of its inputs — adding a track can't reshuffle the others.
 */
export function buildTracksJson(tracks) {
  const result = {};
  for (const track of [...tracks].sort((a, b) => a.name.localeCompare(b.name))) {
    result[track.name] = {
      shortName: track.shortName,
      defaultCourse: track.defaultCourse ?? track.courses[0]?.name ?? '',
      courses: track.courses.map(courseToPublicJson),
    };
  }
  return result;
}

/**
 * Build `public/drawings.json` — outlines keyed "SHORTNAME/CourseName".
 *
 * A course carries its outline inline (plan 0008); upstream kept them in a
 * parallel file. We still emit that file because `loadCourseDrawings()` reads it.
 * A course with an explicit `lengthFt` still publishes its drawing — the outline
 * is the map render, not just a length source.
 */
export function buildDrawingsJson(tracks) {
  const result = {};
  for (const track of [...tracks].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const course of track.courses) {
      if (Array.isArray(course.layout) && course.layout.length >= 2) {
        result[`${track.shortName}/${course.name}`] = course.layout;
      }
    }
  }
  return result;
}

/** Stable filename for a track record. */
export function trackSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Serialize a value the way the committed artifacts are formatted. */
export function stringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
