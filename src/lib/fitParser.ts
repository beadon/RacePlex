/**
 * FIT import (Garmin, Wahoo, Coros, Suunto — issue #17).
 *
 * FIT is the native binary format for the largest installed base of GPS
 * fitness devices out there. Supporting it lets a rider try RacePlex with a
 * ride they already have. It also gives us Metr Pro for free (Metr's URL
 * export supports `?format=fit`).
 *
 * **Set expectations.** These devices log at ~1 Hz. At 40 km/h that's one
 * fix every 11 metres — not enough to place a slalom gate or a braking
 * point precisely. FIT support is for onboarding and comparison, not for
 * lap timing to the second decimal.
 *
 * Detection is by extension + the FIT header magic ("FIT" in bytes 8-10 of
 * a well-formed file). The parser itself (`fit-file-parser`, MIT, 842 kB
 * unpacked) is dynamically imported in `parseFitFile` so the initial bundle
 * stays lean — same rule the GoPro and XRK importers follow.
 *
 * Library choice: NOT `@garmin/fitsdk`. That package ships under Garmin's
 * bespoke "FIT Protocol License Agreement" (a click-through EULA, not an
 * OSI-approved licence). RacePlex is GPL-3, and pulling in
 * GPL-incompatible terms would poison the tree.
 */

import type { ParsedData, FieldMapping, GpsSample } from '@/types/racing';
import { calculateBounds, speedTriple } from './parserUtils';

/** ASCII bytes "FIT" — every FIT file has these at offset 8. */
const FIT_MAGIC = [0x2e, 0x46, 0x49, 0x54]; // ".FIT"

/**
 * Detect a FIT file by extension OR by its 8-byte header + `.FIT` marker.
 * Buffer sniff catches renamed files (a `.dat` from a device menu).
 */
export function isFitFile(fileName: string, buffer?: ArrayBuffer): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.fit')) return true;
  if (buffer && buffer.byteLength >= 12) {
    // FIT header: [size, protocol, profile_lo, profile_hi, data_size(4), '.FIT']
    // We only look at the trailing 4 bytes of the header — that's the fixed
    // magic string on every version.
    const magic = new Uint8Array(buffer, 8, 4);
    if (FIT_MAGIC.every((b, i) => magic[i] === b)) return true;
  }
  return false;
}

/**
 * `fit-file-parser` shape we care about — kept minimal and local so we don't
 * import 100+ lines of vendor types just to lookup a couple of fields.
 */
interface FitRecord {
  timestamp?: string | Date;
  position_lat?: number;
  position_long?: number;
  altitude?: number;
  speed?: number;          // m/s (library default)
  heart_rate?: number;
  cadence?: number;
  power?: number;
  temperature?: number;
  gps_accuracy?: number;
  grade?: number;
}
interface ParsedFitLike {
  records?: FitRecord[];
  sessions?: Array<{ start_time?: string | Date }>;
}

/**
 * Parse a `.fit` file's ArrayBuffer into ParsedData. Async because
 * `fit-file-parser` is dynamically imported (see file docstring for the
 * bundle-size rationale).
 *
 * Rejects with a user-facing Error when the file has no GPS records — a FIT
 * from an indoor workout or a heart-rate-only ride has records but no
 * position, and there's nothing lap-timing can do with that.
 */
export async function parseFitFile(buffer: ArrayBuffer): Promise<ParsedData> {
  const mod = await import('fit-file-parser');
  const FitParser = (mod.default ?? (mod as unknown as { default: unknown }).default) as new (
    opts?: { speedUnit?: string; lengthUnit?: string; mode?: 'list' | 'cascade' | 'both' },
  ) => { parseAsync(b: ArrayBuffer): Promise<ParsedFitLike> };

  const parser = new FitParser({
    speedUnit: 'm/s',
    lengthUnit: 'm',
    mode: 'list',
  });

  let parsed: ParsedFitLike;
  try {
    parsed = await parser.parseAsync(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not read FIT file: ${msg}`, { cause: e });
  }

  return fitToParsedData(parsed);
}

/** Pure mapper: FIT records → ParsedData. Split out so it can be unit-tested. */
export function fitToParsedData(parsed: ParsedFitLike): ParsedData {
  const records = parsed.records ?? [];
  const withGps = records.filter(
    (r): r is FitRecord & { position_lat: number; position_long: number; timestamp: string | Date } =>
      typeof r.position_lat === 'number'
      && typeof r.position_long === 'number'
      && r.timestamp !== undefined,
  );

  if (withGps.length === 0) {
    throw new Error(
      'This FIT file has no GPS records — it may be an indoor workout or a heart-rate-only ride. RacePlex needs positions to time laps.',
    );
  }

  const t0 = new Date(withGps[0].timestamp).getTime();
  const samples: GpsSample[] = [];
  let lastT = -Infinity;

  let hasAltitude = false;
  let hasHeartRate = false;
  let hasCadence = false;
  let hasPower = false;
  let hasTemperature = false;
  let hasAccuracy = false;

  for (const r of withGps) {
    const t = new Date(r.timestamp).getTime() - t0;
    // FIT records are strictly increasing in the vendor's spec, but a
    // stopped-timer session can emit duplicate timestamps. Drop those so
    // the lap engine's monotonic invariant holds.
    if (!(t > lastT) && samples.length > 0) continue;
    lastT = t;

    const speedMps = typeof r.speed === 'number' ? Math.max(0, r.speed) : 0;
    const extraFields: Record<string, number> = {};
    if (typeof r.altitude === 'number') { extraFields['Altitude (m)'] = r.altitude; hasAltitude = true; }
    if (typeof r.heart_rate === 'number') { extraFields['Heart Rate'] = r.heart_rate; hasHeartRate = true; }
    if (typeof r.cadence === 'number') { extraFields['Cadence'] = r.cadence; hasCadence = true; }
    if (typeof r.power === 'number') { extraFields['Power (W)'] = r.power; hasPower = true; }
    if (typeof r.temperature === 'number') { extraFields['Temp (°C)'] = r.temperature; hasTemperature = true; }
    if (typeof r.gps_accuracy === 'number') { extraFields['GPS Accuracy (m)'] = r.gps_accuracy; hasAccuracy = true; }

    samples.push({
      t,
      lat: r.position_lat,
      lon: r.position_long,
      ...speedTriple(speedMps),
      extraFields,
    });
  }

  const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
  let extraIdx = -2;
  if (hasAltitude)   fieldMappings.push({ index: extraIdx--, name: 'Altitude (m)',    enabled: true  });
  if (hasHeartRate)  fieldMappings.push({ index: extraIdx--, name: 'Heart Rate',      enabled: true  });
  if (hasCadence)    fieldMappings.push({ index: extraIdx--, name: 'Cadence',         enabled: true  });
  if (hasPower)      fieldMappings.push({ index: extraIdx--, name: 'Power (W)',       enabled: true  });
  if (hasTemperature)fieldMappings.push({ index: extraIdx--, name: 'Temp (°C)',       enabled: false });
  if (hasAccuracy)   fieldMappings.push({ index: extraIdx,   name: 'GPS Accuracy (m)', enabled: false });

  const startDate = new Date(withGps[0].timestamp);
  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1]?.t ?? 0,
    startDate: Number.isFinite(startDate.getTime()) ? startDate : undefined,
  };
}
