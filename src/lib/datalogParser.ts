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

  // For text formats, read as string
  const text = await file.text();

  // GPX is XML and unambiguous, so it can be claimed first.
  if (isGpxFormat(text)) {
    return parseGpxFile(text);
  }

  // VESC first: its gnss_lat/gnss_lon signature is unambiguous, and it is semicolon-delimited,
  // which the loose comma-oriented matchers below would mangle.
  if (isVescCsvFormat(text)) {
    return parseVescCsvFile(text);
  }

  // RaceBox CSV must be claimed before the loose CSV matchers below (Alfano's and AiM's header
  // checks are broad enough to grab it and then fail to parse the layout).
  if (isRaceBoxCsvFormat(text)) {
    return parseRaceBoxCsvFile(text);
  }

  // Check if it's VBO format
  if (isVboFormat(text)) {
    return parseVboFile(text);
  }
  
  // Check if it's MoTeC CSV format (before Dove/Alfano/AiM since it's more specific)
  if (isMotecCsvFormat(text)) {
    return parseMotecCsvFile(text);
  }
  
  // Check if it's Dovex format (before Dove since it contains Dove data)
  if (isDovexFormat(text)) {
    return parseDovexFile(text);
  }
  
  // Check if it's Dove CSV format
  if (isDoveFormat(text)) {
    return parseDoveFile(text);
  }

  // AiM RaceStudio CSV carries an unambiguous "AiM CSV File" signature. Claim it
  // before Alfano, whose loose header match (rpm/water) would otherwise grab it
  // and then fail to parse the AiM layout.
  if (hasAimSignature(text) && isAimFormat(text)) {
    return parseAimFile(text);
  }

  // Check if it's Alfano CSV format
  if (isAlfanoFormat(text)) {
    return parseAlfanoFile(text);
  }

  // Check if it's AiM CSV format (MyChron, Race Studio 3)
  if (isAimFormat(text)) {
    return parseAimFile(text);
  }

  // LAST RESORT: any delimited table with a latitude and a longitude in it. This must sit below
  // every named format — it would happily claim a RaceBox or MoTeC file and import it worse than
  // its own parser does. It sits ABOVE the NMEA fallback only because NMEA is not a detection at
  // all, just the historical "we give up" path, and a generic GPS CSV has never parsed as NMEA
  // (which requires `$GPRMC` sentences in the first column) — it just failed.
  //
  // Interactive: proposes a column mapping and asks the rider to confirm it, unless they have
  // already confirmed one for this exact header (see genericCsvImport).
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
    // Convert to text for text-based format detection
    const decoder = new TextDecoder();
    const text = decoder.decode(content);

    if (isGpxFormat(text)) {
      return parseGpxFile(text);
    }

    if (isVescCsvFormat(text)) {
      return parseVescCsvFile(text);
    }

    if (isRaceBoxCsvFormat(text)) {
      return parseRaceBoxCsvFile(text);
    }

    if (isVboFormat(text)) {
      return parseVboFile(text);
    }
    
    if (isMotecCsvFormat(text)) {
      return parseMotecCsvFile(text);
    }
    
    if (isDovexFormat(text)) {
      return parseDovexFile(text);
    }
    
    if (isDoveFormat(text)) {
      return parseDoveFile(text);
    }

    if (hasAimSignature(text) && isAimFormat(text)) {
      return parseAimFile(text);
    }

    if (isAlfanoFormat(text)) {
      return parseAlfanoFile(text);
    }

    if (isAimFormat(text)) {
      return parseAimFile(text);
    }

    // Last resort — see routeDatalogFile. No dialog is possible on the sync path, so this uses a
    // remembered mapping if there is one and the auto-proposal otherwise.
    if (isGenericCsvFormat(text)) {
      return importGenericCsvSync(text);
    }

    return parseDatalog(text);
  }

  // String content
  if (isGpxFormat(content)) {
    return parseGpxFile(content);
  }

  if (isVescCsvFormat(content)) {
    return parseVescCsvFile(content);
  }

  if (isRaceBoxCsvFormat(content)) {
    return parseRaceBoxCsvFile(content);
  }

  if (isVboFormat(content)) {
    return parseVboFile(content);
  }

  if (isMotecCsvFormat(content)) {
    return parseMotecCsvFile(content);
  }

  if (isDovexFormat(content)) {
    return parseDovexFile(content);
  }

  if (isDoveFormat(content)) {
    return parseDoveFile(content);
  }

  if (hasAimSignature(content) && isAimFormat(content)) {
    return parseAimFile(content);
  }

  if (isAlfanoFormat(content)) {
    return parseAlfanoFile(content);
  }

  if (isAimFormat(content)) {
    return parseAimFile(content);
  }

  if (isGenericCsvFormat(content)) {
    return importGenericCsvSync(content);
  }

  return parseDatalog(content);
}
