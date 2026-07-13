/**
 * Bundled sample log handling.
 *
 * Samples are treated as ordinary user files: each is seeded into IndexedDB
 * (blob + metadata) so it appears in the file browser and opens through the
 * normal file-load path — no special-case loader, no edge cases. The home-screen
 * "Load sample data" button ensures the default sample is seeded and opens it
 * like any other log; the "show sample files" setting controls their visibility
 * in the browser.
 *
 * To add a sample: drop the file in `public/samples/` and add an entry below.
 */

import { assetUrl } from "./basePath";
import { getFile, saveFile, getFileMetadata, updateFileMetadata } from "./fileStorage";

export interface SampleLog {
  /** Stable IndexedDB key, and the file name under `public/samples/`. */
  fileName: string;
  /** Fixed browser label, instead of the date/time derived name. */
  displayName: string;
  /** Pre-tagged track and course, for a log that doesn't carry its own. */
  trackName?: string;
  courseName?: string;
}

/**
 * The bundled samples. The first is the default — the one "Load sample data"
 * opens.
 *
 * The RaceBox session leads because it is the format this project is most
 * likely to be handed, and it exercises the path that needs no setup: its lap
 * column is read back into timing lines, so lap times appear on open without
 * the user drawing a course. The VESC ride shows the ESC channels charted
 * against GPS. The kart session is inherited from upstream and remains
 * available in the file browser.
 */
export const SAMPLE_LOGS: SampleLog[] = [
  {
    fileName: "racebox-eskate-session.csv",
    displayName: "SAMPLE - RaceBox eskate session",
  },
  {
    fileName: "vesc-tool-ride.csv",
    displayName: "SAMPLE - VESC Tool ride",
  },
  {
    fileName: "okc-tillotson-data.dovex",
    displayName: "SAMPLE - Tillotson 225rs",
    trackName: "Orlando Kart Center",
    courseName: "Normal",
  },
];

/** The sample opened by "Load sample data". */
export const DEFAULT_SAMPLE = SAMPLE_LOGS[0];

/** The default sample's stable IndexedDB key (and bundled asset file name). */
export const SAMPLE_FILE_NAME = DEFAULT_SAMPLE.fileName;
/** Fixed browser label for the default sample. */
export const SAMPLE_DISPLAY_NAME = DEFAULT_SAMPLE.displayName;

/** True when a file name belongs to a bundled sample log. */
export function isSampleFileName(name: string): boolean {
  return SAMPLE_LOGS.some((s) => s.fileName === name);
}

/**
 * Ensure a bundled sample log exists in IndexedDB as a real file (blob +
 * metadata), so it shows up in the browser and opens like any other log.
 *
 * Idempotent: fetches/saves the blob only when missing, and (re)tags the
 * metadata with the sample's track/course, fixed display name, and `isSample`
 * flag. The metadata write is a merge, so a later auto-detect (start time,
 * fastest lap) on open isn't clobbered — and re-running this never undoes it.
 *
 * Returns the sample's blob (existing or freshly fetched), or null on failure.
 */
export async function ensureSampleFile(sample: SampleLog = DEFAULT_SAMPLE): Promise<Blob | null> {
  try {
    let blob = await getFile(sample.fileName);
    if (!blob) {
      const url = assetUrl(`samples/${sample.fileName}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
      blob = await res.blob();
      await saveFile(sample.fileName, blob);
    }
    const meta = await getFileMetadata(sample.fileName);
    if (!meta?.isSample || meta.displayName !== sample.displayName) {
      await updateFileMetadata(sample.fileName, {
        ...(sample.trackName ? { trackName: sample.trackName } : {}),
        ...(sample.courseName ? { courseName: sample.courseName } : {}),
        displayName: sample.displayName,
        isSample: true,
      });
    }
    return blob;
  } catch (e) {
    console.warn(`Failed to seed sample file ${sample.fileName}:`, e);
    return null;
  }
}

/**
 * Seed every bundled sample, so they all appear in the file browser.
 *
 * Settled rather than raced: one sample failing to fetch must not stop the
 * others from seeding.
 */
export async function ensureAllSampleFiles(): Promise<void> {
  await Promise.all(SAMPLE_LOGS.map((s) => ensureSampleFile(s)));
}
