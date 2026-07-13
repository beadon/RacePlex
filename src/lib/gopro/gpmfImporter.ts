// Public entry point for GoPro `.mp4` import — GPMF telemetry, in the browser.
//
// Every rider already films their runs. If the camera had GPS switched on, the
// telemetry is ALREADY IN THE VIDEO FILE: GoPro writes a `gpmd` metadata track
// alongside the video, containing 10–18 Hz GPS plus a ~200 Hz IMU. Import the
// mp4, get a speed-coloured race line and a lap time — no separate logger, no
// upload, no ffmpeg.
//
// Three steps, and the first one is the slow one:
//
//   1. EXTRACT (`gpmf-extract` + `mp4box`) — demux the mp4 and pull the `gpmd`
//      track out. Reads the entire file in 2 MB blocks, so a 4 GB chapter takes
//      real time; it reports progress, which we forward to the load overlay.
//   2. DECODE (`gopro-telemetry`) — GPMF binary -> GPS/ACCL/GYRO streams.
//   3. MAP (`gpmfMapping.ts`, pure) — streams -> ParsedData.
//
// Both libraries are DYNAMICALLY imported (they are not small, and almost no
// session is a GoPro video) so they stay out of the main bundle, exactly like the
// XRK importer keeps libxrk's wasm out of it.

import type { ParsedData } from "@/types/racing";
import type { ImportProgress } from "../importProgress";
import { decodeGpmf } from "./gpmfDecode";
import { NoGoProGpsError, mapGpmfToParsedData } from "./gpmfMapping";
import type { GoProPhase } from "./gpmfTypes";

export { NoGoProGpsError } from "./gpmfMapping";
// Detection lives in its own import-free module so the router can sniff a file
// without pulling this one (and the libraries it loads) into the main bundle.
// Re-exported here so the importer still presents the parsers' usual
// `isXxxFormat` + `parseXxxFile` pair.
export { isGoProFile } from "./gpmfDetect";

/**
 * How long the worker-backed extraction may go without a single byte of progress
 * before we assume it is wedged and redo the work on the main thread. Chosen to
 * be far longer than the first block of any real file takes, and far shorter than
 * a user's patience.
 */
const WORKER_STALL_MS = 15_000;

/** `gpmf-extract` rejects with bare strings, not Errors. Normalize to a message. */
function reasonOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Failures a retry cannot fix: the file simply has no telemetry track, or the
 * user cancelled. Re-running the same demux on the main thread would only waste
 * their time and produce the same answer.
 */
function isFatalExtractionError(error: unknown): boolean {
  const reason = reasonOf(error);
  return (
    reason.includes("Track not found") ||
    reason.includes("File not compatible") ||
    reason.includes("Canceled by user")
  );
}

interface ExtractResult {
  rawData: Uint8Array;
}

/**
 * Pull the raw GPMF payload out of the MP4.
 *
 * `gpmf-extract` defaults to `useWorker: true`, and its own readme warns that
 * "it seems to crash on some recent browsers". So the worker is an OPTIMIZATION,
 * never a requirement:
 *
 *   - No `Worker` in this environment at all (tests, some embedded webviews) —
 *     go straight to the main-thread reader.
 *   - Worker throws on construction, or its child rejects — fall back and redo
 *     the extraction on the main thread.
 *   - Worker starts but never reports a single byte of progress within
 *     `WORKER_STALL_MS` — assume it's wedged, cancel it, fall back. (A silently
 *     dead worker never rejects, so a try/catch alone cannot catch this case.)
 *
 * The main-thread path is slower and jankier but always works, and the progress
 * messages keep flowing either way.
 */
async function extractGpmf(
  file: File,
  onExtractProgress: (ratio: number) => void,
): Promise<ExtractResult> {
  const { default: gpmfExtract } = await import("gpmf-extract");

  const run = (
    useWorker: boolean,
    cancellationToken: { cancelled: boolean },
    onLive?: () => void,
  ) =>
    gpmfExtract(file, {
      browserMode: true,
      useWorker,
      progress: (percent: number) => {
        onLive?.();
        onExtractProgress(percent);
      },
      cancellationToken,
    }) as Promise<ExtractResult>;

  if (typeof Worker === "undefined") {
    return run(false, { cancelled: false });
  }

  const token = { cancelled: false };
  try {
    return await withStallGuard((onLive) => run(true, token, onLive), token);
  } catch (error) {
    if (isFatalExtractionError(error)) throw error;
    // Worker path is unusable in this browser — redo it on the main thread.
    return run(false, { cancelled: false });
  }
}

/**
 * Run `start` against a "no sign of life" timer. Distinct from a plain timeout: a
 * legitimately huge file may take minutes to demux and that is fine — what is NOT
 * fine is a worker that never reports a single block. The timer is disarmed by
 * the first progress tick, so it only ever fires on a stillborn worker.
 */
function withStallGuard<T>(
  start: (onLive: () => void) => Promise<T>,
  token: { cancelled: boolean },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      token.cancelled = true;
      reject(new Error("GPMF worker produced no progress — falling back to the main thread"));
    }, WORKER_STALL_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    start(() => clearTimeout(timer)).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Parse a GoPro `.mp4` into `ParsedData`. Throws a user-facing `Error` on failure
 * — most often `NoGoProGpsError`, which explains that the HERO12 has no GPS and
 * that older HEROs need it switched on.
 */
export async function parseGoProFile(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ParsedData> {
  const report = (phase: GoProPhase, message: string, ratio?: number) =>
    onProgress?.({ phase, message, ...(ratio !== undefined ? { ratio } : {}) });

  report("extract", "Reading GoPro video…");

  let raw: ExtractResult;
  try {
    raw = await extractGpmf(file, (percent) => {
      const ratio = Math.max(0, Math.min(1, percent / 100));
      report("extract", `Reading GoPro video… ${Math.round(ratio * 100)}%`, ratio);
    });
  } catch (error) {
    const reason = reasonOf(error);
    if (reason.includes("Track not found")) {
      throw new NoGoProGpsError(
        "This video has no GoPro telemetry track. It may not be a GoPro video, or it may " +
          "have been re-encoded (most editors strip the metadata track — import the original file).",
        { cause: error },
      );
    }
    throw new Error(`Could not read GoPro telemetry: ${reason}`, { cause: error });
  }

  report("decode", "Decoding GoPro telemetry…");
  const devices = await decodeGpmf(raw.rawData, (ratio) =>
    report("decode", `Decoding GoPro telemetry… ${Math.round(ratio * 100)}%`, ratio),
  );

  report("map", "Building session…");
  const parsed = mapGpmfToParsedData(devices);
  report("done", "Done");
  return parsed;
}
