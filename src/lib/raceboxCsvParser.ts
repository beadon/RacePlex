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
 * Everything else is header-driven, because there is no single "RaceBox CSV": six export presets
 * (custom, seriousracing, telemetryoverlay, racerenderer, fastlap) emit six different column sets,
 * bike mode swaps GForceY for LeanAngle, and the mobile app adds Gyro columns the cloud exporter
 * does not. Fixed column indices would break on most real files.
 */

import { GpsSample, ParsedData } from '@/types/racing';
import {
  KNOTS_TO_MPS,
  KPH_TO_MPS,
  MPH_TO_MPS,
  calculateBounds,
  haversineDistance,
  parseCsvLine,
  speedTriple,
  validateGpsCoords,
} from './parserUtils';

export type RaceBoxSpeedUnit = 'mps' | 'kph' | 'mph' | 'knots';

const SPEED_FACTOR: Record<RaceBoxSpeedUnit, number> = {
  mps: 1,
  kph: KPH_TO_MPS,
  mph: MPH_TO_MPS,
  knots: KNOTS_TO_MPS,
};

/** Expected value of (reported speed / true m/s) for each unit. */
const UNIT_RATIO: Array<[RaceBoxSpeedUnit, number]> = [
  ['mps', 1],
  ['knots', 1 / KNOTS_TO_MPS], // ~1.944
  ['mph', 1 / MPH_TO_MPS], // ~2.237
  ['kph', 3.6],
];

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

/** Read the unit out of an annotated header like `Speed (m/s)` or `KPH`. Null if unannotated. */
function speedUnitFromHeader(header: string): RaceBoxSpeedUnit | null {
  const h = header.toLowerCase();
  if (/\bm\/s\b|\bmps\b/.test(h)) return 'mps';
  if (/\bkph\b|\bkm\/h\b|\bkmh\b/.test(h)) return 'kph';
  if (/\bmph\b/.test(h)) return 'mph';
  if (/\bknots?\b/.test(h)) return 'knots';
  return null;
}

interface RawRow {
  timeMs: number;
  lat: number;
  lon: number;
  reportedSpeed?: number;
  cells: string[];
}

/**
 * Recover the speed column's unit by measuring it against the positions.
 * Returns null when the log has too little movement to tell — a stationary trace has no opinion.
 */
export function detectSpeedUnit(rows: RawRow[]): RaceBoxSpeedUnit | null {
  const ratios: number[] = [];

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const dtSec = (b.timeMs - a.timeMs) / 1000;
    if (dtSec <= 0) continue;

    const reported = b.reportedSpeed;
    if (reported === undefined) continue;

    const derivedMps = haversineDistance(a.lat, a.lon, b.lat, b.lon) / dtSec;

    // Only compare while genuinely moving. At a standstill, GPS jitter gives a derived speed of a
    // few tenths of a m/s against a reported 0, and the ratio is pure noise.
    if (derivedMps < 2 || reported < 2) continue;

    ratios.push(reported / derivedMps);
  }

  if (ratios.length < 20) return null;

  ratios.sort((x, y) => x - y);
  const median = ratios[Math.floor(ratios.length / 2)];

  let best: RaceBoxSpeedUnit | null = null;
  let bestErr = Infinity;
  for (const [unit, expected] of UNIT_RATIO) {
    const err = Math.abs(median - expected) / expected;
    if (err < bestErr) {
      bestErr = err;
      best = unit;
    }
  }

  // Nothing within 15% means this column probably isn't a ground speed at all. Refuse to guess.
  return bestErr < 0.15 ? best : null;
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

  void trackName; // parsed for future session naming; ParsedData has no title field today

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate,
  };
}
