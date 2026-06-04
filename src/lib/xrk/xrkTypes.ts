// Shared message protocol + payload types for the XRK Pyodide worker.
//
// The worker boots Pyodide off the main thread, runs libxrk on the uploaded
// bytes, and ships the parsed channels back as transferable typed-array buffers
// (no giant JSON — sessions are large). The pure mapping in `xrkMapping.ts`
// turns this raw shape into the app's `ParsedData`.

/** Progress phases surfaced to the UI while a session is parsed. */
export type XrkPhase =
  | "boot" // spawning worker / loading the Pyodide runtime
  | "packages" // loadPackage(numpy, pyarrow, micropip)
  | "wheel" // micropip.install(libxrk wheel)
  | "parse" // libxrk reading the binary
  | "extract" // pulling channels into typed arrays
  | "done";

export interface XrkProgress {
  phase: XrkPhase;
  message: string;
  /** 0..1 when a meaningful fraction is known, else undefined (indeterminate). */
  ratio?: number;
}

/** One telemetry channel, already flattened to a single value-per-timecode column. */
export interface XrkChannel {
  /** libxrk channel name, e.g. "GPS Latitude", "Engine RPM", "WT". */
  name: string;
  /** libxrk unit string, e.g. "km/h", "rpm", "°C", "g" (may be empty). */
  unit: string;
  /** Float64 values aligned 1:1 with `timecodes`. */
  values: Float64Array;
}

/**
 * Raw, transport-friendly result of parsing one session. Every channel shares
 * the single `timecodes` axis (the worker resamples to the GPS timebase so each
 * row is one GPS fix). `metadata` is libxrk's session-metadata dict, stringified
 * to primitives; `laps` is libxrk's lap table (informational — the app
 * recomputes laps from the selected course).
 */
export interface XrkRawResult {
  /** Sample timestamps in milliseconds (not yet rebased to zero). */
  timecodes: Float64Array;
  channels: XrkChannel[];
  metadata: Record<string, string | number>;
  laps: { num: number[]; start: number[]; end: number[] };
}

/** main -> worker */
export interface XrkParseRequest {
  type: "parse";
  fileName: string;
  buffer: ArrayBuffer;
  /** Absolute URL of the self-hosted libxrk wheel (resolved on the main thread). */
  wheelUrl: string;
  /** Absolute Pyodide indexURL (CDN). */
  indexUrl: string;
}

/** worker -> main */
export type XrkWorkerMessage =
  | { type: "progress"; progress: XrkProgress }
  | { type: "result"; result: XrkRawResult }
  | { type: "error"; message: string };
