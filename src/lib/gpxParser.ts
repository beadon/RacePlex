/**
 * GPX 1.1 parser.
 *
 * GPX is the lowest common denominator of GPS logging — RaceBox, Strava, Garmin, phone apps and
 * almost every other logger will emit it — which makes it the single widest-reach importer we can
 * add. Upstream has no GPX parser.
 *
 * Two things make GPX different from the other formats here:
 *
 *  1. **There is no speed channel.** GPX carries position, elevation and time, and nothing else.
 *     Speed has to be differentiated from the track. Raw per-sample differentiation of a 25 Hz GPS
 *     trace is far too noisy to chart, so we smooth it (see deriveSpeeds).
 *
 *  2. **Timing lines can ride along as waypoints.** RaceBox writes `<wpt name="Start">` /
 *     `<wpt name="Finish">` into its GPX exports. That means we can reconstruct the course
 *     geometry from the file itself and give the rider working lap timing with no setup at all —
 *     see extractGpxWaypoints / courseFromGpxWaypoints.
 *
 * Parsed with regexes rather than DOMParser, so this runs identically under Node in tests and in
 * the browser, and so a worker can use it without a DOM. GPX out of a logger is machine-generated
 * and highly regular; this is not a general-purpose XML parser and does not pretend to be.
 */

import { Course, GpsSample, ParsedData, SectorLine } from '@/types/racing';
import {
  EARTH_RADIUS_M,
  calculateBearing,
  calculateBounds,
  haversineDistance,
  speedTriple,
  validateGpsCoords,
} from './parserUtils';

/** Default total length of a timing line reconstructed from a waypoint, in metres. */
export const DEFAULT_TIMING_LINE_WIDTH_M = 50;

export interface GpxWaypoint {
  lat: number;
  lon: number;
  name?: string;
}

export function isGpxFormat(content: string): boolean {
  return /<gpx[\s>]/i.test(content.slice(0, 2000));
}

const TRKPT_RE = /<trkpt\b[^>]*?\blat="([^"]+)"[^>]*?\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
const TRKPT_SELF_RE = /<trkpt\b[^>]*?\blat="([^"]+)"[^>]*?\blon="([^"]+)"[^>]*?\/>/gi;
const WPT_RE = /<wpt\b[^>]*?\blat="([^"]+)"[^>]*?\blon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;

function innerTag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m?.[1]?.trim();
}

/**
 * Waypoints, in file order. Exposed separately from parseGpxFile because the import flow wants
 * the samples, while the course-reconstruction path wants the waypoints.
 */
export function extractGpxWaypoints(content: string): GpxWaypoint[] {
  const out: GpxWaypoint[] = [];
  for (const m of content.matchAll(WPT_RE)) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (validateGpsCoords(lat, lon) !== null) continue;
    out.push({ lat, lon, name: innerTag(m[3] ?? '', 'name') });
  }
  return out;
}

/**
 * Smoothed ground speed, differentiated from position.
 *
 * A centred moving average over `window` samples. At 25 Hz, single-sample GPS differentiation
 * swings by several m/s on a rider holding a constant speed — it's dominated by position noise,
 * not motion — and an unsmoothed speed trace is unreadable and useless for lap analysis.
 */
function deriveSpeeds(samples: GpsSample[], window = 5): void {
  if (samples.length < 2) {
    if (samples.length === 1) Object.assign(samples[0], speedTriple(0));
    return;
  }

  const raw = new Array<number>(samples.length).fill(0);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dtSec = (b.t - a.t) / 1000;
    raw[i] = dtSec > 0 ? haversineDistance(a.lat, a.lon, b.lat, b.lon) / dtSec : raw[i - 1];
  }
  raw[0] = raw[1] ?? 0;

  const half = Math.floor(window / 2);
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(samples.length - 1, i + half); j++) {
      sum += raw[j];
      n++;
    }
    Object.assign(samples[i], speedTriple(sum / n));
  }
}

export function parseGpxFile(content: string): ParsedData {
  // Restrict trackpoint scanning to <trk>, so <wpt> and <rte> content can't leak in.
  const trkStart = content.search(/<trk\b/i);
  const trkBody = trkStart === -1 ? content : content.slice(trkStart);

  interface RawPoint {
    lat: number;
    lon: number;
    timeMs?: number;
    ele?: number;
    sats?: number;
  }

  const points: RawPoint[] = [];

  const pushPoint = (latRaw: string, lonRaw: string, body?: string) => {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (validateGpsCoords(lat, lon) !== null) return;

    const pt: RawPoint = { lat, lon };
    if (body) {
      const timeStr = innerTag(body, 'time');
      if (timeStr) {
        const ms = Date.parse(timeStr);
        if (Number.isFinite(ms)) pt.timeMs = ms;
      }
      const eleStr = innerTag(body, 'ele');
      if (eleStr !== undefined && eleStr !== '') {
        const ele = Number(eleStr);
        if (Number.isFinite(ele)) pt.ele = ele;
      }
      // RaceBox writes <siv> ("satellites in view"); the GPX standard says <sat>. Accept both.
      const satStr = innerTag(body, 'sat') ?? innerTag(body, 'siv');
      if (satStr !== undefined && satStr !== '') {
        const sats = Number(satStr);
        if (Number.isFinite(sats)) pt.sats = sats;
      }
    }
    points.push(pt);
  };

  // Multiple <trkseg>s are one continuous ride split by the logger (our RaceBox sample has four).
  // Concatenating them is correct; treating them as separate sessions would fragment the lap.
  for (const m of trkBody.matchAll(TRKPT_RE)) pushPoint(m[1], m[2], m[3]);
  for (const m of trkBody.matchAll(TRKPT_SELF_RE)) pushPoint(m[1], m[2]);

  if (points.length === 0) {
    throw new Error('No valid GPS trackpoints found in GPX file');
  }

  const firstTimed = points.find((p) => p.timeMs !== undefined)?.timeMs;
  const startDate = firstTimed !== undefined ? new Date(firstTimed) : undefined;
  const baseMs = firstTimed ?? 0;

  const samples: GpsSample[] = points.map((p, i) => {
    const extraFields: Record<string, number> = {};
    if (p.ele !== undefined) extraFields['Altitude (m)'] = p.ele;
    if (p.sats !== undefined) extraFields['Satellites'] = p.sats;

    return {
      // A GPX with no <time> at all is a route, not a ride. Index it at a nominal 1 Hz so it still
      // renders on the map rather than collapsing every point onto a single instant.
      t: p.timeMs !== undefined ? p.timeMs - baseMs : i * 1000,
      lat: p.lat,
      lon: p.lon,
      ...speedTriple(0), // replaced by deriveSpeeds below
      extraFields,
    };
  });

  deriveSpeeds(samples);

  // If the file carries its own timing lines, hand them out — the rider gets lap times on import
  // with no setup at all. Nameless GPX (a phone recording, a Strava export) simply has none.
  const waypoints = extractGpxWaypoints(content);
  const embeddedCourse =
    courseFromGpxWaypoints(waypoints, samples, innerTag(content, 'desc') ?? 'Imported course') ??
    undefined;

  const fieldMappings = [
    { index: -1, name: 'Speed', enabled: true },
    ...(samples.some((s) => s.extraFields['Altitude (m)'] !== undefined)
      ? [{ index: -3, name: 'Altitude (m)', enabled: true }]
      : []),
    ...(samples.some((s) => s.extraFields['Satellites'] !== undefined)
      ? [{ index: -2, name: 'Satellites', enabled: true }]
      : []),
  ];

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate,
    ...(embeddedCourse ? { embeddedCourse } : {}),
  };
}

/**
 * Turn a waypoint into a timing line.
 *
 * A waypoint is a bare point; a timing line needs a direction and a length. We recover the
 * direction from the ride itself: the rider's heading as they passed closest to the waypoint is,
 * by definition, the direction that line is meant to be crossed in. The line is then laid
 * perpendicular to that heading, half its width to each side.
 *
 * Heading is taken across a few samples rather than one, because at 25 Hz a single-sample heading
 * is mostly GPS noise.
 */
function timingLineAt(
  wp: GpxWaypoint,
  samples: GpsSample[],
  widthM: number,
): SectorLine | null {
  if (samples.length < 2) return null;

  let nearest = -1;
  let nearestDist = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = haversineDistance(wp.lat, wp.lon, samples[i].lat, samples[i].lon);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = i;
    }
  }
  if (nearest === -1) return null;

  const a = samples[Math.max(0, nearest - 2)];
  const b = samples[Math.min(samples.length - 1, nearest + 2)];
  if (haversineDistance(a.lat, a.lon, b.lat, b.lon) < 0.5) return null; // stationary: no heading

  const heading = calculateBearing(a.lat, a.lon, b.lat, b.lon);

  // Endpoints lie perpendicular to the direction of travel: heading ± 90°.
  const half = widthM / 2;
  const project = (bearingDeg: number) => {
    const rad = (bearingDeg * Math.PI) / 180;
    const dNorth = Math.cos(rad) * half;
    const dEast = Math.sin(rad) * half;
    const latRad = (wp.lat * Math.PI) / 180;
    return {
      lat: wp.lat + (dNorth / EARTH_RADIUS_M) * (180 / Math.PI),
      lon: wp.lon + (dEast / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI),
    };
  };

  return { a: project(heading - 90), b: project(heading + 90) };
}

/**
 * Reconstruct a Course from a GPX's timing waypoints, so a rider who imports a RaceBox GPX gets
 * lap times immediately instead of having to draw a start/finish line by hand.
 *
 * Returns null when the file carries no recognizable timing waypoints.
 *
 * Handles both course shapes:
 *
 *  - CIRCUIT — a single `Start/Finish` waypoint, or a Start and Finish at the same place. A lap
 *    runs from each crossing of that line to the next.
 *  - POINT-TO-POINT — Start and Finish at *different* places, which is what a hill run, a slalom
 *    or a drag strip looks like, and what the real RaceBox export in sample_race_files/ actually
 *    is (its Start and Finish are ~85 m apart). A run goes from the start line to the finish line.
 *
 * The two are told apart by distance, not by naming: if the Start and Finish waypoints are within
 * COINCIDENT_LINE_M of each other they're the same line under two names, which is how a lot of
 * loop courses get exported.
 */
const COINCIDENT_LINE_M = 20;

export function courseFromGpxWaypoints(
  waypoints: GpxWaypoint[],
  samples: GpsSample[],
  name: string,
  widthM: number = DEFAULT_TIMING_LINE_WIDTH_M,
): Course | null {
  const named = (want: string[]) =>
    waypoints.find((w) => want.includes((w.name ?? '').trim().toLowerCase()));

  const startFinish = named(['start/finish', 'start-finish', 'startfinish']);
  const start = named(['start']);
  const finish = named(['finish', 'end']);

  const anchor = startFinish ?? start ?? finish;
  if (!anchor) return null;

  const startLine = timingLineAt(anchor, samples, widthM);
  if (!startLine) return null;

  // A distinct finish line makes this point-to-point.
  let finishLine: SectorLine | null = null;
  if (!startFinish && start && finish) {
    const apart = haversineDistance(start.lat, start.lon, finish.lat, finish.lon);
    if (apart > COINCIDENT_LINE_M) {
      finishLine = timingLineAt(finish, samples, widthM);
    }
  }

  const splits = waypoints.filter((w) => {
    const n = (w.name ?? '').trim().toLowerCase();
    return n.startsWith('split') || n.startsWith('sector');
  });

  const sectors = splits
    .map((w) => timingLineAt(w, samples, widthM))
    .filter((l): l is SectorLine => l !== null)
    .map((l) => ({ line: l, major: true }));

  return {
    name,
    startFinishA: startLine.a,
    startFinishB: startLine.b,
    ...(finishLine ? { finishA: finishLine.a, finishB: finishLine.b } : {}),
    ...(sectors.length > 0 ? { sectors } : {}),
    isUserDefined: false,
  };
}
