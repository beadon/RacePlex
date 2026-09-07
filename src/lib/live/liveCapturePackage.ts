/**
 * `.rplive` — the on-disk package for a live-captured session (RaceBox/Dragy
 * over Web Bluetooth, or the phone-GPS Lap Timer tool), so it can be reopened
 * later the same way any imported log can (plan 0015).
 *
 * Before this, `RaceBoxLiveRecord`/`DragyLiveRecord` each wrote their own ad hoc
 * `{samples, startDate}` JSON under a made-up extension (`.raceboxjson`,
 * `.dragyjson`) that `datalogParser.ts` has never had a parser for — the file
 * landed in the file manager, survived a reload, and then failed to reopen with
 * no parser claiming it. This is exactly the "I have data, it just won't
 * display" failure mode.
 *
 * `.rplive` is deliberately extension-gated, not content-sniffed — it's an
 * app-internal format no real device or export tool produces, so there's no
 * ambiguity to resolve the way there is between (say) Alfano and AiM CSV.
 * `formatVersion` exists so a future field can be added or reinterpreted
 * without breaking already-saved sessions.
 */
import type { ParsedData, GpsSample, FieldMapping } from '@/types/racing';
import { calculateBounds } from '@/lib/parserUtils';

export const LIVE_CAPTURE_EXTENSION = 'rplive';
export const LIVE_CAPTURE_FORMAT_VERSION = 1;

export type LiveCaptureSourceKind = 'racebox' | 'dragy' | 'phone';

export interface LiveCaptureSource {
  kind: LiveCaptureSourceKind;
  /** BLE-advertised device name (e.g. "RaceBox Micro 12AB"), when applicable. */
  deviceName?: string;
}

interface LiveCapturePackageV1 {
  formatVersion: 1;
  source: LiveCaptureSource;
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  /** ISO 8601, when known. */
  startDate?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * `<source>[-device-name]-YYYYMMDD_HHMMSS.rplive` — encodes when the session
 * was recorded and what recorded it, so two sessions never collide and a rider
 * with more than one logger can tell them apart in the file browser.
 */
export function buildLiveCaptureFileName(source: LiveCaptureSource, recordedAt: Date): string {
  const stamp =
    `${recordedAt.getFullYear()}${pad2(recordedAt.getMonth() + 1)}${pad2(recordedAt.getDate())}_` +
    `${pad2(recordedAt.getHours())}${pad2(recordedAt.getMinutes())}${pad2(recordedAt.getSeconds())}`;
  const device = source.deviceName ? `-${slugify(source.deviceName)}` : '';
  return `${source.kind}${device}-${stamp}.${LIVE_CAPTURE_EXTENSION}`;
}

/** Serialize a live capture to its `.rplive` package. */
export function serializeLiveCapture(
  data: Pick<ParsedData, 'samples' | 'fieldMappings' | 'startDate'>,
  source: LiveCaptureSource,
): Blob {
  const pkg: LiveCapturePackageV1 = {
    formatVersion: LIVE_CAPTURE_FORMAT_VERSION,
    source,
    samples: data.samples,
    fieldMappings: data.fieldMappings,
    startDate: data.startDate?.toISOString(),
  };
  return new Blob([JSON.stringify(pkg)], { type: 'application/json' });
}

/** File-extension gate — `.rplive` is app-internal, never content-sniffed. */
export function isLiveCaptureFormat(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(`.${LIVE_CAPTURE_EXTENSION}`);
}

/** Parse a `.rplive` package back into `ParsedData`. */
export function parseLiveCaptureFile(buffer: ArrayBuffer): ParsedData {
  const text = new TextDecoder().decode(buffer);
  let pkg: LiveCapturePackageV1;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw new Error('Not a valid .rplive package: invalid JSON.');
  }
  if (pkg.formatVersion !== LIVE_CAPTURE_FORMAT_VERSION) {
    throw new Error(`Unsupported .rplive format version: ${pkg.formatVersion}`);
  }
  return {
    samples: pkg.samples,
    fieldMappings: pkg.fieldMappings,
    bounds: calculateBounds(pkg.samples),
    duration: pkg.samples.length > 0 ? pkg.samples[pkg.samples.length - 1].t : 0,
    startDate: pkg.startDate ? new Date(pkg.startDate) : undefined,
  };
}
