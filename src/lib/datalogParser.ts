import { ParsedData } from '@/types/racing';
import { normalizeChannels } from './channels';
import { parseDatalog } from './nmeaParser';
import { parseUbxFile, isUbxFormat } from './ubxParser';
import { parseVboFile, isVboFormat } from './vboParser';
import { parseDoveFile, isDoveFormat } from './doveParser';
import { parseDovexFile, isDovexFormat } from './dovexParser';
import { parseAlfanoFile, isAlfanoFormat } from './alfanoParser';
import { parseAimFile, isAimFormat, hasAimSignature } from './aimParser';
import { isMotecLdFormat, parseMotecLdFile, isMotecCsvFormat, parseMotecCsvFile } from './motecParser';
import { isIracingFormat, parseIracingFile } from './iracingParser';
import { isGpxFormat, parseGpxFile } from './gpxParser';
import { isRaceBoxCsvFormat, parseRaceBoxCsvFile } from './raceboxCsvParser';
import { isVescCsvFormat, parseVescCsvFile } from './vescCsvParser';
import { isGenericCsvFormat } from './genericCsvParser';
import { importGenericCsv, importGenericCsvSync } from './genericCsvImport';
import { isRaceChronoCsvV3, rewriteRaceChronoCsvV3 } from './raceChronoCsv';
import { isXrkFile, parseXrkFile } from './xrk/xrkImporter';
// Detection only — the GoPro importer itself (and its ~230 kB of mp4 demuxer +
// GPMF decoder) is dynamic-imported at the call site below, so it never lands in
// the main bundle. `gpmfDetect` has no imports of its own; keep it that way.
import { isGoProFile } from './gopro/gpmfDetect';
import { beginFileLoading, updateFileLoading, endFileLoading } from './fileLoadingState';
import type { ImportProgressCallback } from './importProgress';

/**
 * Unified datalog parser that auto-detects format and routes to appropriate parser.
 * Supports:
 * - MoTeC LD binary format (MoTeC data loggers, sim racing exports)
 * - UBX binary format (u-blox GPS receivers)
 * - iRacing .ibt binary telemetry (the sim's native on-disk export)
 * - VBO format (Racelogic VBOX, RaceBox exports)
 * - MoTeC CSV format (i2 Pro exports)
 * - Dovex format (DovesDataLogger extended with metadata header)
 * - Dove CSV format (simple CSV with Unix timestamps)
 * - Alfano CSV format (Alfano data loggers)
 * - AiM CSV format (MyChron 5/6, Race Studio 3 exports)
 * - AiM XRK/XRZ binary format (MyChron/SoloDL — parsed in-browser via libxrk wasm)
 * - GoPro MP4 (GPMF telemetry track — the GPS is already inside the video file)
 * - Generic GPS CSV (LAST resort: any delimited table with lat/lon — VESC subsets, Float Control,
 *   pOnewheel, TrackAddict, Metr… — with a user-correctable, remembered column mapping)
 * - NMEA text format (CSV with NMEA sentences, .nmea files)
 *
 * `onProgress` only fires for the two async, heavyweight paths — XRK (wasm load +
 * parse) and GoPro (mp4 demux + GPMF decode); every other format parses
 * synchronously and ignores it.
 *
 * Brackets the whole load with the `fileLoadingState` overlay so every "open a
 * file as the session" path (import, file-manager reopen, cloud open) dims the
 * screen while it works. Fast formats finish in the same tick (overlay never
 * paints); the slow XRK and GoPro paths stream their phase messages into it.
 */
export async function parseDatalogFile(
  file: File,
  onProgress?: ImportProgressCallback,
): Promise<ParsedData> {
  beginFileLoading("Loading telemetry…");
  try {
    return normalizeChannels(
      await routeDatalogFile(file, (progress) => {
        updateFileLoading(progress.message);
        onProgress?.(progress);
      }),
    );
  } finally {
    endFileLoading();
  }
}

/**
 * Parse from raw content (for when you already have the data loaded).
 */
export function parseDatalogContent(content: string | ArrayBuffer): ParsedData {
  return normalizeChannels(routeDatalogContent(content));
}

async function routeDatalogFile(
  file: File,
  onProgress?: ImportProgressCallback,
): Promise<ParsedData> {
  const buffer = await file.arrayBuffer();

  // AiM XRK/XRZ binary — detected by extension or `<h` magic. Parsed in a
  // wasm worker (libxrk), so this branch is async + one of the two with progress.
  if (isXrkFile(file.name, buffer)) {
    return parseXrkFile(file, onProgress);
  }

  // GoPro MP4 — the GPMF telemetry track riding inside the video. Demuxing the
  // container is slow and the libraries are lazy-loaded, so this is async too.
  // Claimed before every other binary check: an mp4's `ftyp` magic is unambiguous.
  if (isGoProFile(file.name, buffer)) {
    const { parseGoProFile } = await import('./gopro/gpmfImporter');
    return parseGoProFile(file, onProgress);
  }

  // Check MoTeC LD binary format first (different magic bytes from UBX)
  if (isMotecLdFormat(buffer)) {
    return parseMotecLdFile(buffer);
  }

  // Check if it's UBX binary format
  if (isUbxFormat(buffer)) {
    return parseUbxFile(buffer);
  }

  // Check if it's iRacing .ibt binary telemetry (validated by header + YAML probe)
  if (isIracingFormat(buffer)) {
    return parseIracingFile(buffer);
  }

  // For text formats, read as string and let the ordered detector table decide.
  // The async path only differs from the sync one on the last two entries — it
  // may show the interactive mapping dialog (which needs a File name for the
  // "won't be asked again" hint), so we pass `fileName` down.
  const text = await file.text();
  const named = detectNamedTextFormat(text);
  if (named) return named;
  if (isRaceChronoCsvV3(text)) {
    return importGenericCsv(rewriteRaceChronoCsvV3(text), file.name);
  }
  if (isGenericCsvFormat(text)) {
    return importGenericCsv(text, file.name);
  }

  // Otherwise, treat as NMEA text format
  return parseDatalog(text);
}

function routeDatalogContent(content: string | ArrayBuffer): ParsedData {
  if (content instanceof ArrayBuffer) {
    // AiM XRK needs the async, worker-backed importer (wasm). This sync entry
    // point can't run it, so fail clearly rather than mis-detecting the binary as
    // a text format. In practice nothing reaches here with XRK — every "load a
    // file" path (session, reference, overlay) uses async parseDatalogFile; the
    // remaining sync callers (BLE download, bundled sample) are never XRK.
    if (isXrkFile("", content)) {
      throw new Error("AiM .xrk/.xrz files must be parsed via parseDatalogFile (async).");
    }
    // GoPro MP4 likewise: extraction reads the container in blocks off a File and
    // the GPMF libraries are lazy-loaded, neither of which fits a sync signature.
    if (isGoProFile("", content)) {
      throw new Error("GoPro .mp4 files must be parsed via parseDatalogFile (async).");
    }
    if (isMotecLdFormat(content)) {
      return parseMotecLdFile(content);
    }
    if (isUbxFormat(content)) {
      return parseUbxFile(content);
    }
    if (isIracingFormat(content)) {
      return parseIracingFile(content);
    }
    // Text-based format detection — share the single ordered detector table
    // with the string branch so any new text parser is registered exactly once.
    return routeTextContent(new TextDecoder().decode(content));
  }

  return routeTextContent(content);
}

/**
 * Ordered table of text-format detectors → parsers for **named** formats,
 * shared by the sync and async routes. Returns null when no named format
 * claims the text — callers then run their own generic-CSV branch (async
 * uses the interactive dialog, sync uses the auto-proposal).
 *
 * ORDER MATTERS. Every format that has a specific, unambiguous signature
 * sits above the loose CSV heuristics — Alfano's detector triggers on any
 * file containing common motorsport tokens (`lap`, `rpm`), and AiM's is
 * similarly broad, so a specific format that mentions `session` or `lap`
 * in its metadata would otherwise be silently mis-parsed. Registering a
 * new format is a one-line addition to this table.
 */
type TextParser = (text: string) => ParsedData;
interface TextRoute { name: string; detect: (text: string) => boolean; parse: TextParser }

const NAMED_TEXT_ROUTES: readonly TextRoute[] = [
  { name: 'gpx',        detect: isGpxFormat,        parse: parseGpxFile },
  { name: 'vesc-csv',   detect: isVescCsvFormat,    parse: parseVescCsvFile },
  { name: 'racebox',    detect: isRaceBoxCsvFormat, parse: parseRaceBoxCsvFile },
  { name: 'vbo',        detect: isVboFormat,        parse: parseVboFile },
  { name: 'motec-csv',  detect: isMotecCsvFormat,   parse: parseMotecCsvFile },
  { name: 'dovex',      detect: isDovexFormat,      parse: parseDovexFile },
  { name: 'dove',       detect: isDoveFormat,       parse: parseDoveFile },
  // RaceChrono v3 sits ahead of the loose Alfano/AiM detectors — its
  // two-cell `Format,3` sniff is exact. See issue #33.
  { name: 'racechrono', detect: isRaceChronoCsvV3,  parse: (t) => importGenericCsvSync(rewriteRaceChronoCsvV3(t)) },
  { name: 'aim-signed', detect: (t) => hasAimSignature(t) && isAimFormat(t), parse: parseAimFile },
  { name: 'alfano',     detect: isAlfanoFormat,     parse: parseAlfanoFile },
  { name: 'aim',        detect: isAimFormat,        parse: parseAimFile },
];

/**
 * First named-format hit for `text`, or null when nothing above the generic
 * CSV fallback claims it.
 */
function detectNamedTextFormat(text: string): ParsedData | null {
  for (const route of NAMED_TEXT_ROUTES) {
    if (route.detect(text)) return route.parse(text);
  }
  return null;
}

/**
 * Sync text-content route: named parsers first, then generic CSV (using a
 * remembered mapping or the auto-proposal — no dialog on the sync path),
 * with the NMEA "give up" fallback last.
 */
function routeTextContent(text: string): ParsedData {
  const named = detectNamedTextFormat(text);
  if (named) return named;
  if (isGenericCsvFormat(text)) return importGenericCsvSync(text);
  return parseDatalog(text);
}
