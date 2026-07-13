// Types for the GoPro GPMF import path.
//
// `gopro-telemetry` ships its own .d.ts, but its result type is a generic maze
// keyed on the exact `stream` filter you passed. We only ever consume a handful
// of streams, and always in the same shape, so we declare that shape narrowly
// here and cast the library's output to it once (in `gpmfDecode.ts`). Everything
// downstream — the pure mapping, the tests — works against these types only.

/** Progress phases surfaced while a GoPro video is imported. */
export type GoProPhase =
  | "extract" // pulling the GPMF track out of the MP4 (the slow part — reads the whole file)
  | "decode" // GPMF binary -> GPS/IMU streams
  | "map" // streams -> ParsedData
  | "done";

/**
 * One GPMF sample. `value` is a fixed-order tuple whose meaning depends on the
 * stream (see GPS_* index constants in `gpmfMapping.ts`); scalar streams give a
 * bare number.
 *
 * `cts` is milliseconds since the FIRST VIDEO FRAME — not since the first sample
 * of this stream (GPS gets a lock some way into the recording, so its first
 * `cts` is usually > 0). `date` is the GPS UTC fix time when the camera had a
 * lock, which is what makes a real wall-clock `startDate` possible.
 */
export interface GpmfSample {
  value: number[] | number;
  cts: number;
  /**
   * The library hands this back as a `Date`, not a string — passing it through
   * `Date.parse` silently truncates the milliseconds, which is exactly the kind
   * of quiet 900 ms error that would haunt a lap time. Typed as both, read via
   * `parseGpmfDate`.
   */
  date?: string | Date;
  /**
   * Values GPMF only writes when they change — GPS5's lock type and DOP (×100).
   * We decode with `repeatSticky`, which INLINES them onto every sample and
   * removes the `sticky` object; the nested form is kept for the raw shape.
   */
  fix?: number;
  precision?: number;
  sticky?: Record<string, number | string>;
}

export interface GpmfStream {
  samples: GpmfSample[];
  /** Human-readable stream name, e.g. "GPS (Lat., Long., Alt., 2D speed, 3D speed)". */
  name?: string;
  /** Per-component units, e.g. ["deg","deg","m","m/s","m/s"]. */
  units?: string | string[];
}

export interface GpmfDevice {
  "device name"?: string;
  streams?: Record<string, GpmfStream | undefined>;
}

/** `gopro-telemetry`'s top-level result: device id -> device. Usually just "1". */
export type GpmfDevices = Record<string, GpmfDevice | undefined>;

/** The streams we ask for. Order is the request order, not a preference order. */
export const REQUESTED_STREAMS = ["GPS9", "GPS5", "ACCL", "GYRO"] as const;
