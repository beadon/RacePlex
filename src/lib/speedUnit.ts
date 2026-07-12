/**
 * Recovering a speed column's UNIT, which is the single most dangerous thing about importing a
 * telemetry CSV.
 *
 * Across the formats we care about, the same column means four different things:
 *
 *   gnss_gVel        (VESC)          metres per second
 *   Speed (Km/h)     (Float Control) km/h
 *   speed_kph        (pOnewheel)     km/h
 *   Speed(mph)       (TrackAddict)   mph
 *   Speed            (RaceBox)       whatever the exporter was set to — NOT recorded in the file
 *
 * Guessing from the magnitude is not an option: 25 is a plausible eskate speed in all three units.
 * A wrong guess is a silent 3.6x data-corruption bug that still charts beautifully, so nobody
 * catches it.
 *
 * So we ask the data. Ground speed derived from consecutive GPS fixes is noisy per sample but
 * unbiased in aggregate; compare its median against the reported column and snap to the nearest
 * known unit. On the real RaceBox export in `sample_race_files/` this yields a ratio of 3.588 →
 * kph, which is correct.
 *
 * Lives in its own module (rather than raceboxCsvParser, where it was born) because every
 * header-driven CSV importer needs it — see genericCsvParser.
 */

import { KNOTS_TO_MPS, KPH_TO_MPS, MPH_TO_MPS, haversineDistance } from './parserUtils';

export type SpeedUnit = 'mps' | 'kph' | 'mph' | 'knots';

/** Multiply a reported speed by this to get m/s. */
export const SPEED_FACTOR: Record<SpeedUnit, number> = {
  mps: 1,
  kph: KPH_TO_MPS,
  mph: MPH_TO_MPS,
  knots: KNOTS_TO_MPS,
};

/** Expected value of (reported speed / true m/s) for each unit. */
const UNIT_RATIO: Array<[SpeedUnit, number]> = [
  ['mps', 1],
  ['knots', 1 / KNOTS_TO_MPS], // ~1.944
  ['mph', 1 / MPH_TO_MPS], // ~2.237
  ['kph', 3.6],
];

/** Human labels for the mapping dialog. */
export const SPEED_UNIT_LABELS: Record<SpeedUnit, string> = {
  mps: 'm/s',
  kph: 'km/h',
  mph: 'mph',
  knots: 'knots',
};

/**
 * Read the unit out of an annotated header — `Speed (m/s)`, `speed_kph`, `Speed(mph)`, `KPH`.
 * Null when the name says nothing, which is the common case and why measurement exists.
 */
export function speedUnitFromHeader(header: string): SpeedUnit | null {
  // Loosen the separators so `speed_kph`, `Speed (Km/h)` and `SpeedKmh` all read the same.
  const h = header.toLowerCase().replace(/[_\-.]/g, ' ');
  if (/\bm\/s\b|\bmps\b|meters?\s*per\s*sec/.test(h)) return 'mps';
  if (/\bkph\b|\bkm\/h\b|\bkmh\b|\bkm\s*h\b/.test(h)) return 'kph';
  if (/\bmph\b|\bmi\/h\b/.test(h)) return 'mph';
  if (/\bknots?\b|\bkts\b/.test(h)) return 'knots';
  return null;
}

/** The minimum a caller must supply for a measurement: a time, a position, and the reported value. */
export interface SpeedUnitSample {
  /** Any monotonic millisecond timebase — only differences are used. */
  timeMs: number;
  lat: number;
  lon: number;
  reportedSpeed?: number;
}

/**
 * Recover the speed column's unit by measuring it against the positions.
 * Returns null when the log has too little movement to tell — a stationary trace has no opinion,
 * and refusing to answer is the correct answer.
 *
 * ⚠️ Feed this DISTINCT GPS FIXES, not raw rows. Loggers that write GNSS at 1 Hz while logging
 * everything else at 10-50 Hz repeat lat/lon across rows; consecutive raw rows then give a derived
 * speed of 0 (filtered out) except at the fix boundary, where a full second of travel is divided by
 * a 20 ms row gap and the ratio comes out ~50x too small. Measuring on the fixes avoids all of it.
 */
export function detectSpeedUnit(samples: SpeedUnitSample[]): SpeedUnit | null {
  const ratios: number[] = [];

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
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
  const median = ratios[Math.floor(ratios.length / 2)]!;

  let best: SpeedUnit | null = null;
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
