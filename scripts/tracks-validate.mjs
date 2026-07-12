/**
 * Validation for submitted track records (plan 0008).
 *
 * A track that merges must be *usable*, not merely well-formed. Schema checks
 * catch a missing field; they never catch a transposed digit in a longitude. So
 * we also check that the geometry is coherent — that timing lines are line-sized
 * and that, where an outline exists, they actually cross it.
 *
 * Pure: takes records, returns problems. The CI wrapper does the I/O.
 */

import { haversineMeters, lineCrossesLayout, timingLines, trackSlug } from './tracks-format.mjs';

/**
 * A start/finish line spans a track, not a county. Anything wider than this is a
 * coordinate error, not a wide circuit.
 */
const MAX_LINE_METERS = 500;
/** Below this the two ends are effectively the same point — the line has no direction. */
const MIN_LINE_METERS = 1;
const MAX_SHORT_NAME = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isLat = (v) => isNum(v) && v >= -90 && v <= 90;
const isLon = (v) => isNum(v) && v >= -180 && v <= 180;

/**
 * Validate one track record. Returns an array of human-readable problems —
 * empty means it is good to merge.
 *
 * @param track  the parsed `tracks/<slug>.json` record
 * @param file   its filename, for messages
 */
export function validateTrack(track, file) {
  const problems = [];
  const p = (msg) => problems.push(`${file}: ${msg}`);

  if (typeof track?.name !== 'string' || !track.name.trim()) {
    p('missing "name"');
    return problems; // nothing else is meaningful without it
  }

  const expected = `${trackSlug(track.name)}.json`;
  if (file !== expected) {
    p(`filename should be "${expected}" to match the track name "${track.name}"`);
  }

  if (typeof track.shortName !== 'string' || !track.shortName.trim()) {
    p('missing "shortName"');
  } else if (track.shortName.length > MAX_SHORT_NAME) {
    p(`"shortName" is ${track.shortName.length} chars, max is ${MAX_SHORT_NAME}`);
  }

  if (!Array.isArray(track.courses) || track.courses.length === 0) {
    p('needs at least one course');
    return problems;
  }

  if (track.defaultCourse != null && !track.courses.some((c) => c?.name === track.defaultCourse)) {
    p(`"defaultCourse": "${track.defaultCourse}" is not one of this track's courses`);
  }

  const seenCourses = new Set();
  for (const course of track.courses) {
    const label = typeof course?.name === 'string' && course.name.trim()
      ? `course "${course.name}"`
      : 'course (unnamed)';

    if (typeof course?.name !== 'string' || !course.name.trim()) {
      p('a course is missing "name"');
      continue;
    }
    if (seenCourses.has(course.name)) {
      p(`duplicate ${label}`);
    }
    seenCourses.add(course.name);

    if (course.lengthFt != null && (!isNum(course.lengthFt) || course.lengthFt <= 0)) {
      p(`${label}: "lengthFt" must be a positive number`);
    }

    // Timing-line geometry: present, in range, and line-sized.
    for (const key of ['start_a_lat', 'start_b_lat']) {
      if (!isLat(course[key])) p(`${label}: "${key}" is not a valid latitude`);
    }
    for (const key of ['start_a_lng', 'start_b_lng']) {
      if (!isLon(course[key])) p(`${label}: "${key}" is not a valid longitude`);
    }

    for (const line of timingLines(course)) {
      if (!isLat(line.a.lat) || !isLat(line.b.lat) || !isLon(line.a.lon) || !isLon(line.b.lon)) {
        p(`${label}: ${line.label} has an out-of-range coordinate`);
        continue;
      }
      // (0, 0) is in the Gulf of Guinea. Nobody rides there; it means "unset".
      for (const end of [line.a, line.b]) {
        if (end.lat === 0 && end.lon === 0) {
          p(`${label}: ${line.label} has a (0, 0) coordinate — looks unset`);
        }
      }
      const span = haversineMeters(line.a, line.b);
      if (span > MAX_LINE_METERS) {
        p(`${label}: ${line.label} is ${Math.round(span)} m wide (max ${MAX_LINE_METERS} m) — check for a typo`);
      } else if (span < MIN_LINE_METERS) {
        p(`${label}: ${line.label} is ${span.toFixed(2)} m wide — its two ends are the same point`);
      }
    }

    // Outline coherence — the check that actually catches a bad coordinate.
    if (course.layout != null) {
      if (!Array.isArray(course.layout) || course.layout.length < 2) {
        p(`${label}: "layout" must be an array of at least 2 points`);
      } else if (course.layout.some((pt) => !isLat(pt?.lat) || !isLon(pt?.lon))) {
        p(`${label}: "layout" has an invalid point (needs {lat, lon})`);
      } else {
        for (const line of timingLines(course)) {
          if (!lineCrossesLayout(line, course.layout)) {
            p(`${label}: ${line.label} does not cross the drawn outline — the line is in the wrong place, or the outline is`);
          }
        }
      }
    }
  }

  return problems;
}

/**
 * Validate the whole collection: every record, plus the cross-track uniqueness
 * that no single file can check for itself.
 *
 * @param records  [{ file, track }]
 */
export function validateCollection(records) {
  const problems = records.flatMap(({ file, track }) => validateTrack(track, file));

  const byName = new Map();
  const byShort = new Map();
  for (const { file, track } of records) {
    if (typeof track?.name === 'string' && track.name.trim()) {
      byName.set(track.name, [...(byName.get(track.name) ?? []), file]);
    }
    if (typeof track?.shortName === 'string' && track.shortName.trim()) {
      byShort.set(track.shortName, [...(byShort.get(track.shortName) ?? []), file]);
    }
  }
  for (const [name, files] of byName) {
    if (files.length > 1) problems.push(`duplicate track name "${name}" in: ${files.join(', ')}`);
  }
  // shortName keys drawings.json and the file browser — a collision silently
  // makes two tracks share one outline.
  for (const [short, files] of byShort) {
    if (files.length > 1) problems.push(`duplicate shortName "${short}" in: ${files.join(', ')}`);
  }

  return problems;
}
