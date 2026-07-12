/**
 * RaceBox CSV parser.
 *
 * RaceBox (Mini / Mini S / Micro) is the most common GPS logger in this category, and its CSV is
 * the format most riders will actually have. Upstream has no RaceBox parser. (It will read a
 * RaceBox .vbo via the VBO parser, but not the CSV, which is what the app exports by default.)
 *
 * ┌─ WHY THIS PARSER MEASURES THE SPEED COLUMN INSTEAD OF TRUSTING IT ─────────────────────────┐
 * │                                                                                            │
 * │ RaceBox's exporter lets the user pick m/s, kph or mph — and then writes the header as a     │
 * │ bare `Speed` regardless. The unit is simply not recorded anywhere in the file.              │
 * │                                                                                            │
 * │ Picking a default would be a silent data-corruption bug: every speed in the app would be    │
 * │ wrong by 3.6x, while still looking entirely plausible on a chart. Nobody would notice.      │
 * │                                                                                            │
 * │ So we ask the data instead. Ground speed derived from consecutive fixes is noisy per sample │
 * │ but unbiased in aggregate, so we compare its median against the reported column and snap to │
 * │ the nearest known unit. On the real RaceBox export in sample_race_files/ this yields a      │
 * │ ratio of 3.588 -> kph, which is correct.                                                    │
 * └────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * The other thing this parser does that the format does not hand it for free is recover the course
 * geometry from the `Lap` column — see courseFromDeviceLaps. The CSV has no waypoints, so without
 * that a rider importing the CSV of a session gets no lap timing while the GPX of the *same*
 * session times it fine.
 *
 * Everything else is header-driven, because there is no single "RaceBox CSV": six export presets
 * (custom, seriousracing, telemetryoverlay, racerenderer, fastlap) emit six different column sets,
 * bike mode swaps GForceY for LeanAngle, and the mobile app adds Gyro columns the cloud exporter
 * does not. Fixed column indices would break on most real files.
 */

import { Course, GpsSample, ParsedData, SectorLine } from '@/types/racing';
import {
  calculateBounds,
  haversineDistance,
  parseCsvLine,
  speedTriple,
  validateGpsCoords,
} from './parserUtils';
import {
  SPEED_FACTOR,
  detectSpeedUnit,
  speedUnitFromHeader,
  type SpeedUnit,
} from './speedUnit';
import {
  COINCIDENT_LINE_M,
  DEFAULT_TIMING_LINE_WIDTH_M,
  LatLon,
  timingLineBetween,
} from './timingLines';

/**
 * The unit detector this parser was built around now lives in `speedUnit.ts`, because every
 * header-driven CSV importer needs it (see genericCsvParser). Re-exported here so the RaceBox
 * story stays readable from its own file.
 */
export { detectSpeedUnit };
export type RaceBoxSpeedUnit = SpeedUnit;

/** Strip a UTF-8 BOM, which some exports carry. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Normalize a header for comparison: `Altitude (m)` and `altitude` are the same channel. */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

function findColumn(headers: string[], ...candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const c of candidates) {
    const i = normalized.indexOf(normalizeHeader(c));
    if (i !== -1) return i;
  }
  return -1;
}

interface RawRow {
  timeMs: number;
  lat: number;
  lon: number;
  reportedSpeed?: number;
  cells: string[];
}

export function isRaceBoxCsvFormat(content: string): boolean {
  const head = stripBom(content).split(/\r?\n/, 40);

  if (head.some((l) => /^Format\s*,\s*RaceBox/i.test(l))) return true;

  // Bare exports carry no metadata block at all — our real sample starts straight at the header
  // row — so fall back to the column signature. `Lap` + G-force columns alongside lat/lon is
  // distinctive enough to separate RaceBox from a generic GPS CSV.
  return head.some((line) => {
    const cells = parseCsvLine(line).map(normalizeHeader);
    return (
      cells.includes('latitude') &&
      cells.includes('longitude') &&
      cells.includes('lap') &&
      (cells.includes('gforcex') || cells.includes('x'))
    );
  });
}

/**
 * RaceBox's `timeFormat` option produces four different things in the Time column:
 *   utc / local -> ISO8601      (`2026-06-21T20:43:33.160Z`)
 *   relative    -> seconds since session start (`0.000`)
 *   itow        -> seconds since GPS week start (`143379.900`)
 * Returns milliseconds. For the numeric forms that's an offset rather than an epoch, which is fine
 * because every caller immediately subtracts the first row's value.
 */
function parseRaceBoxTime(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (!v) return undefined;

  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v) * 1000;

  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

/** A change in the device's lap number, and the sample index it first shows up on. */
interface LapTransition {
  /** A lap number going UP is the rider crossing the START line. Going to 0 is the FINISH. */
  kind: 'start' | 'finish';
  /** Index of the first sample carrying the NEW lap number; the crossing is just before it. */
  index: number;
}

/**
 * Reconstruct the course geometry from the device's own `Lap` column.
 *
 * The CSV has no waypoints — unlike the GPX of the very same session, which is why importing the
 * CSV used to give "No Track Detected" while the GPX gave lap times. But the `Lap` column is a
 * record of the device's own timing decisions: it tells us exactly WHEN RaceBox considered a
 * timing line to have been crossed, and the GPS columns tell us WHERE the rider was at that
 * moment. That is enough to rebuild the lines.
 *
 * On the real session in sample_race_files/, the two crossings recovered this way land 3.6 m and
 * 3.4 m from the Start / Finish waypoints that the GPX of the same session carries — i.e. within
 * the width of the racing line. Timing agrees to ~40 ms (see pointToPoint.test.ts).
 *
 * Telling a circuit from a point-to-point course is the one genuinely ambiguous part, because the
 * device uses the same column for both:
 *
 *   circuit          0 1 1 1 2 2 2 3 3 3 0     laps count up at one line, crossed over and over
 *   point-to-point   0 1 1 1 0 0 0 2 2 2 0     each run starts at one line and ends at another
 *
 * The tell is the SHAPE, not the distance: on a circuit the lap number climbs straight from one
 * lap to the next with no return to 0 in between, so a course is only point-to-point when starts
 * and finishes strictly alternate (every run that began also ended). This matters — a rider who
 * simply leaves the track after three circuit laps also produces one drop to 0, at a position
 * nowhere near any timing line, and treating that as a finish line would fabricate a lap time
 * spanning all three laps. The COINCIDENT_LINE_M distance check then still collapses the
 * degenerate single-lap loop, whose one crossing pair sits at the same place.
 *
 * Returns null whenever the column gives us no honest evidence of a start line — no `Lap` column,
 * an all-zero column (the rider never armed a run), or a log that only ever counts DOWN because it
 * began mid-run. A wrong course is worse than no course: downstream, no course simply means the
 * rider is asked to pick one.
 */
export function courseFromDeviceLaps(
  samples: GpsSample[],
  name: string,
  widthM: number = DEFAULT_TIMING_LINE_WIDTH_M,
): Course | null {
  const transitions: LapTransition[] = [];

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].extraFields['Device Lap'];
    const cur = samples[i].extraFields['Device Lap'];
    if (prev === undefined || cur === undefined || prev === cur) continue;

    if (cur > prev) transitions.push({ kind: 'start', index: i });
    else if (cur === 0) transitions.push({ kind: 'finish', index: i });
    // A drop to a lower but non-zero lap number is not a thing the device does; ignore it rather
    // than reading geometry out of a corrupt column.
  }

  const firstStart = transitions.find((t) => t.kind === 'start');
  if (!firstStart) return null;

  // All the "start" transitions describe the same physical line (that is what a lap counter IS),
  // so one is enough — and the first is the one whose geometry we can most safely trust, since it
  // is a crossing the device actually acted on rather than an average of several racing lines that
  // would drag the line's centre off the track.
  const start = timingLineBetween(samples, firstStart.index, widthM);
  if (!start) return null; // stationary at the transition: no heading, so no line

  const finishLine = pointToPointFinish(samples, transitions, start.at, widthM);

  return {
    name,
    startFinishA: start.line.a,
    startFinishB: start.line.b,
    ...(finishLine ? { finishA: finishLine.a, finishB: finishLine.b } : {}),
    isUserDefined: false,
  };
}

/**
 * The separate finish line of a point-to-point course, or null when this is a circuit.
 * See courseFromDeviceLaps for why alternation — not distance alone — decides.
 */
function pointToPointFinish(
  samples: GpsSample[],
  transitions: LapTransition[],
  startAt: LatLon,
  widthM: number,
): SectorLine | null {
  const alternates = transitions.every((t, i) => t.kind === (i % 2 === 0 ? 'start' : 'finish'));
  if (!alternates) return null;

  const firstFinish = transitions.find((t) => t.kind === 'finish');
  if (!firstFinish) return null; // the run never ended — the log stops mid-run

  const finish = timingLineBetween(samples, firstFinish.index, widthM);
  if (!finish) return null;

  const apart = haversineDistance(startAt.lat, startAt.lon, finish.at.lat, finish.at.lon);
  return apart > COINCIDENT_LINE_M ? finish.line : null;
}

export function parseRaceBoxCsvFile(content: string): ParsedData {
  const lines = stripBom(content).split(/\r?\n/);

  // Find the header row. Anything before it is `Key,Value` metadata and `Lap N, <time>, sectors,
  // ...` summary lines — or, in a bare export, nothing at all.
  let headerIdx = -1;
  let trackName: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;

    const cells = parseCsvLine(line);
    const normalized = cells.map(normalizeHeader);

    if (normalized.includes('latitude') && normalized.includes('longitude')) {
      headerIdx = i;
      break;
    }
    if (/^track$/i.test(cells[0]?.trim() ?? '') && cells[1]?.trim()) {
      trackName = cells[1].trim();
    }
  }

  if (headerIdx === -1) {
    throw new Error('No valid GPS data found in RaceBox CSV (no Latitude/Longitude header)');
  }

  const headers = parseCsvLine(lines[headerIdx]).map((h) => h.trim());

  const cTime = findColumn(headers, 'Time');
  const cLat = findColumn(headers, 'Latitude');
  const cLon = findColumn(headers, 'Longitude');
  const cSpeed = findColumn(headers, 'Speed', 'KPH');
  const cAlt = findColumn(headers, 'Altitude');
  const cHeading = findColumn(headers, 'Heading');
  const cLap = findColumn(headers, 'Lap');
  const cGx = findColumn(headers, 'GForceX', 'X');
  const cGy = findColumn(headers, 'GForceY', 'Y');
  const cGz = findColumn(headers, 'GForceZ', 'Z');
  const cLean = findColumn(headers, 'LeanAngle');
  const cGyroX = findColumn(headers, 'GyroX');
  const cGyroY = findColumn(headers, 'GyroY');
  const cGyroZ = findColumn(headers, 'GyroZ');

  if (cLat === -1 || cLon === -1 || cTime === -1) {
    throw new Error('RaceBox CSV missing required Time/Latitude/Longitude columns');
  }

  const cellNum = (cells: string[], idx: number): number | undefined => {
    if (idx === -1) return undefined;
    const v = cells[idx];
    if (v === undefined || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  // Pass 1 — raw rows, speed still in whatever unit the file happens to use.
  const rows: RawRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;

    const cells = parseCsvLine(line);
    const lat = cellNum(cells, cLat);
    const lon = cellNum(cells, cLon);
    if (lat === undefined || lon === undefined) continue;
    if (validateGpsCoords(lat, lon) !== null) continue;

    const timeMs = parseRaceBoxTime(cells[cTime]);
    if (timeMs === undefined) continue;

    rows.push({ timeMs, lat, lon, reportedSpeed: cellNum(cells, cSpeed), cells });
  }

  if (rows.length === 0) {
    throw new Error('No valid GPS data found in RaceBox CSV');
  }

  // Pass 2 — resolve the speed unit: annotated header first, then measurement, then a documented
  // assumption of kph (what the default export actually produces).
  let speedUnit: RaceBoxSpeedUnit = 'kph';
  let speedUnitSource: 'header' | 'detected' | 'assumed' = 'assumed';

  if (cSpeed !== -1) {
    const fromHeader = speedUnitFromHeader(headers[cSpeed]);
    if (fromHeader) {
      speedUnit = fromHeader;
      speedUnitSource = 'header';
    } else {
      const detected = detectSpeedUnit(rows);
      if (detected) {
        speedUnit = detected;
        speedUnitSource = 'detected';
      }
    }
  }

  const factor = SPEED_FACTOR[speedUnit];
  const baseMs = rows[0].timeMs;

  const samples: GpsSample[] = rows.map((row) => {
    const { cells } = row;
    const extraFields: Record<string, number> = {};

    const alt = cellNum(cells, cAlt);
    if (alt !== undefined) extraFields['Altitude (m)'] = alt;

    const gx = cellNum(cells, cGx);
    const gy = cellNum(cells, cGy);
    const gz = cellNum(cells, cGz);
    // Bike mode drops GForceY entirely and carries LeanAngle in its place.
    if (gx !== undefined) extraFields['Lon G (Native)'] = gx;
    if (gy !== undefined) extraFields['Lat G (Native)'] = gy;
    if (gz !== undefined) extraFields['Vert G (Native)'] = gz;

    const lean = cellNum(cells, cLean);
    if (lean !== undefined) extraFields['Lean Angle'] = lean;

    const gyroX = cellNum(cells, cGyroX);
    const gyroY = cellNum(cells, cGyroY);
    const gyroZ = cellNum(cells, cGyroZ);
    if (gyroX !== undefined) extraFields['Gyro X'] = gyroX;
    if (gyroY !== undefined) extraFields['Gyro Y'] = gyroY;
    if (gyroZ !== undefined) extraFields['Gyro Z'] = gyroZ;

    // RaceBox's own lap numbering. 0 means out-lap / not on a timed run. Preserved because it is
    // ground truth from the device, and lets us cross-check our own lap detection.
    const lap = cellNum(cells, cLap);
    if (lap !== undefined) extraFields['Device Lap'] = lap;

    const heading = cellNum(cells, cHeading);

    const sample: GpsSample = {
      t: row.timeMs - baseMs,
      lat: row.lat,
      lon: row.lon,
      ...speedTriple((row.reportedSpeed ?? 0) * factor),
      extraFields,
    };
    if (heading !== undefined) sample.heading = heading;
    return sample;
  });

  const has = (key: string) => samples.some((s) => s.extraFields[key] !== undefined);

  const fieldMappings = [
    { index: -1, name: 'Speed', enabled: true },
    ...(has('Altitude (m)') ? [{ index: -3, name: 'Altitude (m)', enabled: true }] : []),
    ...(has('Lon G (Native)') ? [{ index: -12, name: 'Lon G (Native)', enabled: true }] : []),
    ...(has('Lat G (Native)') ? [{ index: -13, name: 'Lat G (Native)', enabled: true }] : []),
    ...(has('Vert G (Native)') ? [{ index: -14, name: 'Vert G (Native)', enabled: true }] : []),
    ...(has('Lean Angle') ? [{ index: -16, name: 'Lean Angle', enabled: true }] : []),
    ...(has('Gyro X') ? [{ index: -17, name: 'Gyro X', enabled: false }] : []),
    ...(has('Gyro Y') ? [{ index: -18, name: 'Gyro Y', enabled: false }] : []),
    ...(has('Gyro Z') ? [{ index: -19, name: 'Gyro Z', enabled: false }] : []),
    ...(has('Device Lap') ? [{ index: -30, name: 'Device Lap', enabled: false }] : []),
  ];

  // Only an absolute (ISO) time column gives a real wall-clock start date; the relative and iTOW
  // formats are offsets, and inventing a date from them would be a lie.
  const firstTimeCell = rows[0].cells[cTime]?.trim() ?? '';
  const isAbsolute = !/^-?\d+(\.\d+)?$/.test(firstTimeCell);
  const startDate = isAbsolute ? new Date(baseMs) : undefined;

  // The CSV carries no waypoints, but its Lap column records where the device's own timing lines
  // are. Rebuild them and hand the course out exactly as the GPX parser does, so importing either
  // export of the same session gives the same lap times.
  const embeddedCourse = courseFromDeviceLaps(samples, trackName ?? 'Imported course') ?? undefined;

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate,
    ...(embeddedCourse ? { embeddedCourse } : {}),
  };
}
