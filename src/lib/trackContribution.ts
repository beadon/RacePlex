/**
 * Turn a user's local tracks into a contribution they can actually submit
 * (plan 0008).
 *
 * The track collection lives in git — `tracks/<slug>.json`, one file per track,
 * submitted by pull request. There is no server to POST to. So the app's job at
 * the end of the submit flow is to hand the rider the exact file content and a
 * way to get it to us; `trackSubmission.ts` already worked out *what* is new, and
 * this module renders it.
 *
 * Kept free of React and of network calls so it is unit-testable, and so the
 * eager landing bundle pays nothing for it.
 */

import type { Course, Track } from '@/types/racing';
import { normalizeCourseSectors } from '@/lib/courseSectors';
import { sectorsToJson } from '@/lib/trackStorage';
import type { SubmissionCourse } from '@/lib/trackSubmission';

/** Where a contribution goes. */
export const TRACKS_REPO = 'beadon/RacePlex';
const ISSUE_TEMPLATE = 'track_submission.yml';

/**
 * GitHub rejects a URL over ~8 kB, and a drawn outline is easily hundreds of
 * points, so a prefilled issue body can blow the limit. Past this we still open
 * the form, but with the body left out and the JSON on the clipboard instead.
 */
const MAX_PREFILL_BYTES = 6000;

/** One track's `tracks/<slug>.json` content, ready to paste or commit. */
export interface TrackContribution {
  trackName: string;
  /** Filename the record must have — the validator enforces this. */
  fileName: string;
  /** The file content, formatted exactly as a committed track record. */
  json: string;
  /** Courses in this contribution (for the UI to summarise). */
  courseNames: string[];
}

/** Slugify a track name into its record filename. Mirrors scripts/tracks-format.mjs. */
export function trackSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Serialize one course into the track-record course shape. */
function courseRecord(course: Course, sub: SubmissionCourse): Record<string, unknown> {
  const norm = normalizeCourseSectors(course);
  const out: Record<string, unknown> = {
    name: sub.courseName,
  };
  if (course.lengthFt != null) out.lengthFt = course.lengthFt;

  Object.assign(out, {
    start_a_lat: sub.courseData.start_a_lat,
    start_a_lng: sub.courseData.start_a_lng,
    start_b_lat: sub.courseData.start_b_lat,
    start_b_lng: sub.courseData.start_b_lng,
  });

  // Canonical ordered sector list — the record format prefers this over the
  // legacy sector_2/sector_3 mirror, which exists only for inherited tracks.
  const sectors = sectorsToJson(norm.sectors);
  if (sectors && sectors.length > 0) out.sectors = sectors;

  if (sub.layout && sub.layout.length >= 2) out.layout = sub.layout;

  return out;
}

/**
 * Build the contributable track records for a set of selected courses.
 *
 * Courses are grouped by track, because the record format is one file per track:
 * a rider who drew three courses at one spot contributes one file, not three.
 * `merged` supplies the live `Course` objects (the plan carries only the flat
 * submission payload, which has no `lengthFt`).
 */
export function buildContributions(
  selected: SubmissionCourse[],
  merged: Track[],
  credit?: string,
  today: string = new Date().toISOString().slice(0, 10),
): TrackContribution[] {
  const byTrack = new Map<string, SubmissionCourse[]>();
  for (const c of selected) {
    byTrack.set(c.trackName, [...(byTrack.get(c.trackName) ?? []), c]);
  }

  const out: TrackContribution[] = [];
  for (const [trackName, courses] of byTrack) {
    const liveTrack = merged.find((t) => t.name === trackName);
    const shortName = courses[0].trackShortName ?? liveTrack?.shortName;

    const record: Record<string, unknown> = {
      name: trackName,
      shortName,
      defaultCourse: courses[0].courseName,
      courses: courses.map((sub) => {
        const live = liveTrack?.courses.find((c) => c.name === sub.courseName);
        return courseRecord(live ?? ({} as Course), sub);
      }),
    };

    const meta: Record<string, unknown> = { addedAt: today };
    if (credit?.trim()) meta.submittedBy = credit.trim();
    record.meta = meta;

    out.push({
      trackName,
      fileName: `${trackSlug(trackName)}.json`,
      json: `${JSON.stringify(record, null, 2)}\n`,
      courseNames: courses.map((c) => c.courseName),
    });
  }
  return out;
}

/**
 * URL for a prefilled track-submission issue.
 *
 * The JSON rides in the query string when it fits; when it doesn't (a long drawn
 * outline), we open the empty form and rely on the caller having put the JSON on
 * the clipboard — better than a URL GitHub will reject outright.
 */
export function issueUrl(contribution: TrackContribution, location?: string): {
  url: string;
  prefilled: boolean;
} {
  const base = `https://github.com/${TRACKS_REPO}/issues/new`;
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `Track: ${contribution.trackName}`,
    'track-name': contribution.trackName,
  });
  if (location?.trim()) params.set('location', location.trim());

  const withBody = new URLSearchParams(params);
  withBody.set('track-json', contribution.json);
  const candidate = `${base}?${withBody}`;

  if (candidate.length <= MAX_PREFILL_BYTES) {
    return { url: candidate, prefilled: true };
  }
  return { url: `${base}?${params}`, prefilled: false };
}
