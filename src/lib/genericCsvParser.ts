/**
 * The generic GPS-CSV importer.
 *
 * Every eskate logger emits its own CSV layout — VESC Tool, Float Control, pOnewheel, TrackAddict,
 * Metr, Qstarz — and none of them are stable enough to hardcode:
 *
 *   - pOnewheel generates its columns PER RIDE, from whichever BLE attributes that ride recorded.
 *     A fixed column map for it is impossible by construction.
 *   - Float Control reorders columns between app versions.
 *   - TrackAddict's column set depends on which sensors and OBD-II PIDs the user switched on.
 *   - Metr's varies by ESC count.
 *
 * So this reads the table by NAME (csvTable.ts), proposes a mapping, and — crucially — SHOWS the
 * rider what it decided and lets them fix it (CsvMappingDialog). A rider with a logger we have
 * never seen can import their ride today, and their correction tells us the real schema.
 *
 * ┌─ THE TWO PLACES THIS WOULD SILENTLY PRODUCE GARBAGE ────────────────────────────────────────┐
 * │                                                                                             │
 * │ Both produce plausible-looking-but-WRONG output, which is worse than failing.               │
 * │                                                                                             │
 * │ 1. TIME UNITS. `ms_today` (ms since local midnight), `Time(s)` (seconds since start),       │
 * │    `time` (epoch ms) and `UTC Time` (epoch SECONDS as a float) all appear, and the column   │
 * │    NAME does not tell you which. We infer from the values (see inferTimeUnit) — and then we │
 * │    show the rider the first timestamp and the session duration, because "this 40-second run │
 * │    apparently lasted 4 hours" is a tell anyone can read.                                    │
 * │                                                                                             │
 * │ 2. SPEED UNITS. `gnss_gVel` is m/s, `Speed (Km/h)` is km/h, `Speed(mph)` is mph — and       │
 * │    RaceBox writes a bare `Speed` whose unit is not recorded anywhere. 25 is a plausible     │
 * │    eskate speed in all of them, so the magnitude tells you NOTHING. We read the header if   │
 * │    it is annotated, and otherwise MEASURE the column against position-derived speed         │
 * │    (speedUnit.ts). With no speed column at all we derive speed from the positions.          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * The GPS-repeat problem (1 Hz GNSS, 10-50 Hz everything else) is handled by gpsFixes.ts: keep
 * every row, interpolate position between distinct fixes. Decimating to the GPS rate would throw
 * away the fast channels, which are the whole reason to import one of these logs.
 */

import { GpsSample, ParsedData } from '@/types/racing';
import { cellNumber, columnIndex, parseCsvTable, type CsvTable } from './csvTable';
import { fnv1a } from './fnv1a';
import { collectGpsAnchors, createPositionInterpolator } from './gpsFixes';
import { calculateBounds, haversineDistance, speedTriple } from './parserUtils';
import {
  SPEED_FACTOR,
  detectSpeedUnit,
  speedUnitFromHeader,
  type SpeedUnit,
  type SpeedUnitSample,
} from './speedUnit';

// ─── The mapping ────────────────────────────────────────────────────────────

/**
 * How a time column's numbers become milliseconds.
 *
 *   epoch_ms   1750000000000     Unix epoch, ms          (pOnewheel `time`)
 *   epoch_s    1750000000.25     Unix epoch, seconds     (TrackAddict `UTC Time`, a float)
 *   ms_today   45296120          ms since LOCAL midnight (VESC `ms_today`) — wraps at midnight
 *   sec_today  45296.12          s since local midnight  (some NMEA-ish exports)
 *   elapsed_s  0.00, 0.05, …     seconds since start     (Float Control `Time(s)`)
 *   elapsed_ms 0, 50, 100, …     ms since start
 *   iso        2026-06-21T20:…   a date string
 *   row_index  (no time column)  synthesised at a fixed rate — always low confidence
 */
export type TimeUnit =
  | 'epoch_ms'
  | 'epoch_s'
  | 'ms_today'
  | 'sec_today'
  | 'elapsed_s'
  | 'elapsed_ms'
  | 'iso'
  | 'row_index';

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  epoch_ms: 'Unix epoch (ms)',
  epoch_s: 'Unix epoch (seconds)',
  ms_today: 'Milliseconds since midnight',
  sec_today: 'Seconds since midnight',
  elapsed_s: 'Seconds since start',
  elapsed_ms: 'Milliseconds since start',
  iso: 'Date/time text (ISO 8601)',
  row_index: 'No time column — assume 10 Hz',
};

export type { SpeedUnit };

/** Which column is which. `-1` means "not mapped". */
export interface CsvColumnMapping {
  lat: number;
  lon: number;
  time: number;
  speed: number;
  altitude: number;
  heading: number;
  accuracy: number;
  timeUnit: TimeUnit;
  speedUnit: SpeedUnit;
}

/** The mappable roles, in the order the dialog lists them. */
export const MAPPABLE_FIELDS = [
  'lat',
  'lon',
  'time',
  'speed',
  'altitude',
  'heading',
  'accuracy',
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

/**
 * Header-name aliases per role, matched by `columnIndex()` — which is insensitive to case, spaces,
 * underscores, hyphens and a trailing parenthetical unit. So one alias `gps lat` already covers
 * `gps_lat`, `GPS-Lat` and `GPS Lat`, and `time` covers `Time(s)`.
 *
 * Order matters: the most specific / least ambiguous alias goes first, because the first hit wins.
 * `lon` before `long` before `lng`; `latitude` before the bare `lat` (a column literally named
 * `lat` is fine, but `Latitude` is the safer signal when a file has both).
 */
const ALIASES: Record<MappableField, string[]> = {
  // Deliberately NOT `x`/`y`: several of these formats carry accelerometer columns named exactly
  // that, and silently importing G-force as a longitude is the kind of bug this parser exists to
  // avoid.
  lat: ['latitude', 'gnss_lat', 'gps_lat', 'gps latitude', 'lat'],
  lon: [
    'longitude',
    'gnss_lon',
    'gnss_long',
    'gps_lon',
    'gps_long',
    'gps longitude',
    'lon',
    'long',
    'lng',
  ],
  time: [
    'ms_today',
    'utc time',
    'timestamp',
    'utc',
    'time',
    'elapsed',
    'elapsed time',
    'seconds',
    'datetime',
    'date time',
  ],
  speed: [
    'gnss_gvel',
    'speed_kph',
    'speed_mph',
    'speed_mps',
    'speed',
    'gps speed',
    'ground speed',
    'velocity',
    'vel',
    'speed_meters_per_sec',
  ],
  altitude: ['altitude', 'gnss_alt', 'gps_alt', 'alt', 'elevation', 'ele', 'height'],
  heading: ['heading', 'gnss_heading', 'course', 'bearing', 'track', 'yaw'],
  accuracy: ['gnss_hacc', 'h_acc', 'horizontal accuracy', 'accuracy', 'hacc', 'hdop'],
};

/** A column named exactly one of these is NEVER a bare-`lat`/`x`-style coordinate match. */
function autoMapField(columns: string[], field: MappableField): number {
  return columnIndex(columns, ...ALIASES[field]);
}

// ─── Analysis ───────────────────────────────────────────────────────────────

export interface MappingPreview {
  /** Rows in the file (before GPS-lock trimming). */
  rowCount: number;
  /** Samples the current mapping would actually emit. */
  sampleCount: number;
  /** Distinct GPS fixes found — far smaller than sampleCount on a 1 Hz-GNSS logger. */
  gpsFixCount: number;
  /**
   * The first timestamp as the mapping reads it: an ISO string when the time column is absolute,
   * otherwise `0.000 s` (relative). THE tell for a wrong time unit is the pair of this and
   * `durationMs`.
   */
  firstTimestamp: string;
  /** Session length in ms under the current mapping. A 40 s run reading 4 h means wrong units. */
  durationMs: number;
  /** Mean sample rate implied by the timebase — another wrong-unit tell (0.003 Hz, 3000 Hz…). */
  sampleRateHz: number;
  firstCoord: { lat: number; lon: number } | null;
  /** Top speed in m/s under the current speed mapping + unit. */
  maxSpeedMps: number;
  /** Columns that will ride along as extra telemetry channels. */
  extraColumns: string[];
}

export interface GenericCsvAnalysis {
  table: CsvTable;
  /**
   * Identity of this file's SHAPE, not its contents: fnv1a over the delimiter + the column names.
   * A rider's second ride off the same device hashes the same, so their correction is remembered
   * and the dialog never appears again. See csvMappingStorage.ts.
   */
  headerHash: string;
  mapping: CsvColumnMapping;
  /**
   * `high`  — everything was named or measured outright.
   * `medium`— something was inferred from the values and could plausibly be wrong.
   * `low`   — we had to fall back on an assumption. SHOW THE DIALOG.
   */
  confidence: 'high' | 'medium' | 'low';
  /** How each of the two dangerous units was decided — surfaced verbatim in the dialog. */
  timeUnitSource: 'inferred' | 'assumed';
  speedUnitSource: 'header' | 'measured' | 'assumed' | 'derived';
  /** Plain-English notes for the dialog ("Speed measured against GPS: ratio 3.59 → km/h"). */
  notes: string[];
  preview: MappingPreview;
}

/**
 * Is this a delimited table with a GPS position in it? Deliberately loose — this is the LAST parser
 * in the router, so by the time we are asked, every named format has already declined the file.
 * The bar is only "we can find a header, and it has a latitude and a longitude".
 */
export function isGenericCsvFormat(content: string): boolean {
  let table: CsvTable;
  try {
    table = parseCsvTable(content);
  } catch {
    return false;
  }
  if (table.rows.length < 2 || table.columns.length < 2) return false;

  const lat = autoMapField(table.columns, 'lat');
  const lon = autoMapField(table.columns, 'lon');
  if (lat === -1 || lon === -1) return false;

  // A header alone proves nothing — require at least one row with a real coordinate on it, so a
  // file with a `Latitude` column and no fixes fails loudly rather than importing as an empty ride.
  return table.rows.some((row) => {
    const la = cellNumber(row, lat);
    const lo = cellNumber(row, lon);
    return (
      la !== undefined &&
      lo !== undefined &&
      !(la === 0 && lo === 0) &&
      Math.abs(la) <= 90 &&
      Math.abs(lo) <= 180
    );
  });
}

/** Hash of the file's SHAPE — delimiter + column names. The persistence key. */
export function headerHash(table: CsvTable): string {
  return fnv1a(`${table.delimiter}${table.columns.join('')}`);
}

// ─── Time ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Median of a numeric list. Robust to the one row where the logger hiccupped. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Work out what a time column's numbers MEAN. This is the inference that, when wrong, produces a
 * ride that silently claims to have lasted four hours.
 *
 * The magnitude of the FIRST value separates most of it, because an elapsed column starts at ~0 and
 * an absolute one does not:
 *
 *   >= 1e12   epoch ms      (1.75e12 = 2025)
 *   >= 1e9    epoch seconds (1.75e9  = 2025) — TrackAddict's `UTC Time`, a float
 *   >= 1e5    ms since midnight (1e5 ms = 00:01:40; a day is 8.64e7)
 *   >= 3600   seconds since midnight  — only when it cannot be an elapsed column, i.e. it is big
 *   else      elapsed — and then the SPACING decides s vs ms.
 *
 * The elapsed s-vs-ms split is the genuinely ambiguous one, so it goes by the median row spacing:
 * real loggers run at 1-100 Hz, so a gap is 0.01-1 in seconds and 10-1000 in ms. A gap of >= 5
 * cannot be seconds unless the logger samples slower than once every 5 s, which none of these do.
 */
export function inferTimeUnit(values: number[]): { unit: TimeUnit; confident: boolean } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return { unit: 'elapsed_ms', confident: false };

  const first = finite[0]!;
  const abs = Math.abs(first);

  if (abs >= 1e12) return { unit: 'epoch_ms', confident: true };
  if (abs >= 1e9) return { unit: 'epoch_s', confident: true };

  const gaps: number[] = [];
  for (let i = 1; i < finite.length && gaps.length < 500; i++) {
    const d = finite[i]! - finite[i - 1]!;
    if (d > 0) gaps.push(d);
  }
  const gap = median(gaps);

  // Absolute-but-not-epoch: a time-of-day column. Starts somewhere in the middle of the day, so it
  // cannot be an elapsed column (those start at ~0).
  if (abs >= 1e5) return { unit: 'ms_today', confident: true };
  if (abs >= 3600 && gap < 5) return { unit: 'sec_today', confident: true };

  // Elapsed. The spacing is all we have.
  if (gap >= 5) return { unit: 'elapsed_ms', confident: gap >= 8 };
  return { unit: 'elapsed_s', confident: gap > 0 && gap <= 2 };
}

/** True when the column's cells are date TEXT rather than numbers. */
function looksLikeDateText(cells: string[]): boolean {
  const sample = cells.find((c) => c.trim() !== '');
  if (!sample) return false;
  if (/^-?\d+(\.\d+)?$/.test(sample.trim())) return false;
  return Number.isFinite(Date.parse(sample.trim()));
}

/** True when the unit describes a real wall-clock instant (so we can hand out a `startDate`). */
function isAbsolute(unit: TimeUnit): boolean {
  return unit === 'epoch_ms' || unit === 'epoch_s' || unit === 'iso';
}

/**
 * The timebase: every row's ELAPSED milliseconds from the first row, plus the wall-clock start
 * when the unit gives us one.
 *
 * `ms_today` / `sec_today` wrap at midnight. We only ever use them as a difference from the first
 * row, so unwrapping the wrap is the only thing worth doing.
 */
export function buildTimebase(
  table: CsvTable,
  mapping: CsvColumnMapping,
): { times: number[]; startDate?: Date } {
  const n = table.rows.length;
  const { time: col, timeUnit } = mapping;

  if (col === -1 || timeUnit === 'row_index') {
    // No usable time column: assume 10 Hz so the ride at least plays back. Always LOW confidence —
    // the dialog says so, and every distance-vs-time reading is a guess until the rider fixes it.
    return { times: Array.from({ length: n }, (_, i) => i * 100) };
  }

  if (timeUnit === 'iso') {
    const raw = table.rows.map((r) => Date.parse((r[col] ?? '').trim()));
    const base = raw.find((v) => Number.isFinite(v)) ?? 0;
    return {
      times: raw.map((v) => (Number.isFinite(v) ? v - base : 0)),
      startDate: Number.isFinite(base) ? new Date(base) : undefined,
    };
  }

  const scale =
    timeUnit === 'epoch_s' || timeUnit === 'elapsed_s' || timeUnit === 'sec_today' ? 1000 : 1;
  const wraps = timeUnit === 'ms_today' || timeUnit === 'sec_today';

  const out: number[] = [];
  let dayOffset = 0;
  let prev: number | undefined;

  for (const row of table.rows) {
    let t = (cellNumber(row, col) ?? 0) * scale;
    if (wraps && prev !== undefined && t + dayOffset < prev - 1000) dayOffset += MS_PER_DAY;
    t += dayOffset;
    prev = t;
    out.push(t);
  }

  const base = out[0] ?? 0;
  return {
    times: out.map((t) => t - base),
    startDate: isAbsolute(timeUnit) ? new Date(base) : undefined,
  };
}

// ─── Auto-mapping ───────────────────────────────────────────────────────────

/**
 * Propose a mapping for a file, with everything the dialog needs to show its work.
 * This is the function the whole feature turns on; `parseGenericCsvTable` just executes its output.
 */
export function analyzeGenericCsv(content: string): GenericCsvAnalysis {
  const table = parseCsvTable(content);

  const lat = autoMapField(table.columns, 'lat');
  const lon = autoMapField(table.columns, 'lon');
  if (lat === -1 || lon === -1) {
    throw new Error('CSV: could not find latitude / longitude columns');
  }

  const time = autoMapField(table.columns, 'time');
  const speed = autoMapField(table.columns, 'speed');
  const altitude = autoMapField(table.columns, 'altitude');
  const heading = autoMapField(table.columns, 'heading');
  const accuracy = autoMapField(table.columns, 'accuracy');

  const notes: string[] = [];

  // ── Time unit ──
  let timeUnit: TimeUnit;
  let timeUnitSource: GenericCsvAnalysis['timeUnitSource'];
  let timeConfident: boolean;

  if (time === -1) {
    timeUnit = 'row_index';
    timeUnitSource = 'assumed';
    timeConfident = false;
    notes.push('No time column found — assuming a 10 Hz sample rate. Check this.');
  } else if (looksLikeDateText(table.rows.map((r) => r[time] ?? ''))) {
    timeUnit = 'iso';
    timeUnitSource = 'inferred';
    timeConfident = true;
    notes.push(`Time column "${table.columns[time]}" holds date text.`);
  } else {
    const values = table.rows.map((r) => cellNumber(r, time) ?? NaN);
    const inferred = inferTimeUnit(values);
    timeUnit = inferred.unit;
    timeUnitSource = 'inferred';
    timeConfident = inferred.confident;
    notes.push(
      `Time column "${table.columns[time]}" read as ${TIME_UNIT_LABELS[timeUnit].toLowerCase()}` +
        (inferred.confident ? '.' : ' — but the values are ambiguous. Check the duration below.'),
    );
  }

  const draft: CsvColumnMapping = {
    lat,
    lon,
    time,
    speed,
    altitude,
    heading,
    accuracy,
    timeUnit,
    speedUnit: 'mps',
  };

  // ── Speed unit ──
  // The header first (it is the only place the unit is ever RECORDED), then measurement against the
  // positions. Never the magnitude of the values: 25 is plausible in m/s, km/h and mph alike.
  let speedUnit: SpeedUnit = 'mps';
  let speedUnitSource: GenericCsvAnalysis['speedUnitSource'] = 'derived';
  let speedConfident = true;

  if (speed === -1) {
    notes.push('No speed column found — speed will be derived from the GPS positions.');
  } else {
    const fromHeader = speedUnitFromHeader(table.columns[speed] ?? '');
    if (fromHeader) {
      speedUnit = fromHeader;
      speedUnitSource = 'header';
      notes.push(`Speed unit read from the column name "${table.columns[speed]}".`);
    } else {
      const { times } = buildTimebase(table, draft);
      const measured = measureSpeedUnit(table, draft, times);
      if (measured) {
        speedUnit = measured;
        speedUnitSource = 'measured';
        notes.push(
          `Speed column "${table.columns[speed]}" is unlabelled — measured against GPS-derived speed as ${measured}.`,
        );
      } else {
        // Not enough movement to measure, and the name says nothing. km/h is the most common
        // unlabelled export, but this is a guess and it is flagged as one.
        speedUnit = 'kph';
        speedUnitSource = 'assumed';
        speedConfident = false;
        notes.push(
          `Speed column "${table.columns[speed]}" is unlabelled and the ride has too little movement to measure it — ASSUMING km/h. Check this.`,
        );
      }
    }
  }

  const mapping: CsvColumnMapping = { ...draft, speedUnit };

  const confidence: GenericCsvAnalysis['confidence'] =
    !timeConfident || !speedConfident ? 'low' : timeUnitSource === 'inferred' && time !== -1 ? 'medium' : 'high';

  return {
    table,
    headerHash: headerHash(table),
    mapping,
    confidence,
    timeUnitSource,
    speedUnitSource,
    notes,
    preview: previewMapping(table, mapping),
  };
}

/**
 * Measure the reported speed column against position-derived speed.
 *
 * ⚠️ Measures on the DISTINCT GPS FIXES, not on the rows. On a 1 Hz-GNSS / 20 Hz-everything-else
 * logger, consecutive rows carry the same fix: derived speed is 0 for 19 rows and then a whole
 * second of travel divided by a 50 ms row gap on the 20th. Measuring on raw rows there gives a
 * ratio ~20x off and confidently picks the wrong unit.
 */
function measureSpeedUnit(
  table: CsvTable,
  mapping: CsvColumnMapping,
  times: number[],
): SpeedUnit | null {
  const anchors = collectGpsAnchors({
    rowCount: table.rows.length,
    times,
    lat: (i) => cellNumber(table.rows[i]!, mapping.lat),
    lon: (i) => cellNumber(table.rows[i]!, mapping.lon),
  });

  const samples: SpeedUnitSample[] = anchors.map((a) => ({
    timeMs: a.t,
    lat: a.lat,
    lon: a.lon,
    reportedSpeed: cellNumber(table.rows[a.row]!, mapping.speed),
  }));

  return detectSpeedUnit(samples);
}

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * What the rider will get if they accept this mapping. Cheap enough to recompute on every dropdown
 * change in the dialog, which is the point: change the time unit, watch the duration change.
 */
export function previewMapping(table: CsvTable, mapping: CsvColumnMapping): MappingPreview {
  const { times, startDate } = buildTimebase(table, mapping);

  const anchors = collectGpsAnchors({
    rowCount: table.rows.length,
    times,
    lat: (i) => cellNumber(table.rows[i]!, mapping.lat),
    lon: (i) => cellNumber(table.rows[i]!, mapping.lon),
  });

  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const sampleCount = first && last ? last.row - first.row + 1 : 0;
  const durationMs = first && last ? (times[last.row] ?? 0) - (times[first.row] ?? 0) : 0;

  let maxSpeedMps = 0;
  if (mapping.speed !== -1) {
    const factor = SPEED_FACTOR[mapping.speedUnit];
    for (const row of table.rows) {
      const v = cellNumber(row, mapping.speed);
      if (v !== undefined && v * factor > maxSpeedMps) maxSpeedMps = v * factor;
    }
  } else if (first && last) {
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!;
      const b = anchors[i]!;
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const v = haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt;
      if (v > maxSpeedMps && v < 150) maxSpeedMps = v;
    }
  }

  return {
    rowCount: table.rows.length,
    sampleCount,
    gpsFixCount: anchors.length,
    firstTimestamp: startDate ? startDate.toISOString() : '0.000 s (relative to the first row)',
    durationMs,
    sampleRateHz: durationMs > 0 && sampleCount > 1 ? ((sampleCount - 1) / durationMs) * 1000 : 0,
    firstCoord: first ? { lat: first.lat, lon: first.lon } : null,
    maxSpeedMps,
    extraColumns: extraColumnIndices(table, mapping).map((i) => table.columns[i]!),
  };
}

// ─── Parse ──────────────────────────────────────────────────────────────────

/**
 * Every column that is not one of the mapped roles but does hold numbers.
 *
 * This is how pOnewheel's per-ride BLE attributes and VESC's ESC channels survive an import we
 * wrote no code for: we do not need to know what `duty_cycle` or `ADC1` mean to put them on the
 * chart next to speed.
 */
function extraColumnIndices(table: CsvTable, mapping: CsvColumnMapping): number[] {
  const used = new Set(MAPPABLE_FIELDS.map((f) => mapping[f]).filter((i) => i !== -1));
  const probe = table.rows.slice(0, 50);

  const out: number[] = [];
  for (let i = 0; i < table.columns.length; i++) {
    if (used.has(i)) continue;
    if (!table.columns[i]?.trim()) continue;
    if (probe.some((row) => cellNumber(row, i) !== undefined)) out.push(i);
  }
  return out;
}

/**
 * Speed derived from the anchors, smoothed.
 *
 * Single-sample GPS differentiation swings by several m/s on a rider holding a constant speed — it
 * is dominated by position noise, not motion — so a raw trace is unreadable. Same 5-sample centred
 * mean the GPX parser uses.
 */
function deriveAnchorSpeeds(
  anchors: { t: number; lat: number; lon: number }[],
  window = 5,
): number[] {
  const raw = new Array<number>(anchors.length).fill(0);
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    const dt = (b.t - a.t) / 1000;
    raw[i] = dt > 0 ? haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt : raw[i - 1]!;
  }
  raw[0] = raw[1] ?? 0;

  const half = Math.floor(window / 2);
  return raw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(raw.length - 1, i + half); j++) {
      sum += raw[j]!;
      n++;
    }
    return n > 0 ? sum / n : 0;
  });
}

/** Extra channels default to visible, but only the first few — a 54-column VESC log would otherwise
 * open with 50 series on the chart and be unreadable. The rest are one click away in the picker. */
const MAX_ENABLED_EXTRAS = 8;

export function parseGenericCsvTable(table: CsvTable, mapping: CsvColumnMapping): ParsedData {
  if (mapping.lat === -1 || mapping.lon === -1) {
    throw new Error('CSV: no latitude / longitude column selected');
  }

  const { times, startDate } = buildTimebase(table, mapping);

  // ── Pass 1: the distinct GPS fixes. ──
  const anchors = collectGpsAnchors({
    rowCount: table.rows.length,
    times,
    lat: (i) => cellNumber(table.rows[i]!, mapping.lat),
    lon: (i) => cellNumber(table.rows[i]!, mapping.lon),
  });

  if (anchors.length === 0) {
    throw new Error('CSV: no valid GPS fixes found in the selected latitude / longitude columns');
  }

  const positionAt = createPositionInterpolator(anchors);

  // No speed column: derive it from the fixes and interpolate the derived value across the rows in
  // between, so the fast channels still get a speed on every row.
  const derived = mapping.speed === -1 ? deriveAnchorSpeeds(anchors) : null;
  const derivedAt = (t: number): number => {
    if (!derived) return 0;
    let i = 0;
    while (i + 1 < anchors.length && anchors[i + 1]!.t <= t) i++;
    const a = anchors[i]!;
    const b = anchors[Math.min(i + 1, anchors.length - 1)]!;
    if (b === a || b.t <= a.t) return derived[i]!;
    const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    return derived[i]! + (derived[Math.min(i + 1, derived.length - 1)]! - derived[i]!) * u;
  };

  const extras = extraColumnIndices(table, mapping);
  const factor = SPEED_FACTOR[mapping.speedUnit];

  // ── Pass 2: emit EVERY row between the first and last fix, position interpolated. ──
  const samples: GpsSample[] = [];
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;

  for (let i = first.row; i <= last.row; i++) {
    const row = table.rows[i]!;
    const t = times[i] ?? 0;
    const { lat, lon } = positionAt(t);

    const speedMps =
      mapping.speed === -1 ? derivedAt(t) : (cellNumber(row, mapping.speed) ?? 0) * factor;

    const extraFields: Record<string, number> = {};

    const alt = cellNumber(row, mapping.altitude);
    if (alt !== undefined) extraFields['Altitude (m)'] = alt;
    const acc = cellNumber(row, mapping.accuracy);
    if (acc !== undefined) extraFields['GPS Accuracy (m)'] = acc;

    for (const c of extras) {
      const v = cellNumber(row, c);
      if (v !== undefined) extraFields[table.columns[c]!] = v;
    }

    const sample: GpsSample = {
      t,
      lat,
      lon,
      ...speedTriple(Math.max(0, speedMps)),
      extraFields,
    };

    const heading = cellNumber(row, mapping.heading);
    if (heading !== undefined) sample.heading = heading;

    samples.push(sample);
  }

  const has = (key: string) => samples.some((s) => s.extraFields[key] !== undefined);

  let enabledExtras = 0;
  const fieldMappings = [
    { index: -1, name: 'Speed', enabled: true },
    ...(has('Altitude (m)') ? [{ index: -3, name: 'Altitude (m)', enabled: true }] : []),
    ...extras
      .filter((c) => has(table.columns[c]!))
      .map((c, n) => ({
        index: -100 - n,
        name: table.columns[c]!,
        enabled: enabledExtras++ < MAX_ENABLED_EXTRAS,
      })),
    ...(has('GPS Accuracy (m)') ? [{ index: -50, name: 'GPS Accuracy (m)', enabled: false }] : []),
  ];

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1]!.t,
    ...(startDate ? { startDate } : {}),
  };
}

/** Convenience: analyse and parse in one go, taking the proposed mapping as-is (no user input). */
export function parseGenericCsvFile(
  content: string,
  override?: Partial<CsvColumnMapping>,
): ParsedData {
  const analysis = analyzeGenericCsv(content);
  return parseGenericCsvTable(analysis.table, { ...analysis.mapping, ...override });
}
