// GPMF binary -> telemetry streams.
//
// Thin wrapper over `gopro-telemetry`, kept separate from the extraction step so
// the decode + mapping can be unit-tested against the pre-extracted `.raw` GPMF
// payloads in `src/lib/__fixtures__/` without ever demuxing an MP4 (or committing
// a multi-megabyte video).
//
// The library is DYNAMICALLY imported so it — and its `binary-parser` dep — stay
// out of the main bundle. It only loads when someone actually drops a GoPro
// video in.

import { MAX_SPEED_MPS } from "../parserUtils";
import { REQUESTED_STREAMS, type GpmfDevices } from "./gpmfTypes";

/**
 * Decode a raw GPMF payload (the bytes of the `gpmd` track) into GPS/IMU streams.
 *
 * `onProgress` receives 0..1. The library warns it is "not proportional" — it's
 * a liveness signal, not an ETA.
 */
export async function decodeGpmf(
  rawData: Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<GpmfDevices> {
  const { default: goproTelemetry } = await import("gopro-telemetry");

  const result = await goproTelemetry(
    { rawData },
    {
      stream: [...REQUESTED_STREAMS],
      // Put GPS5's sticky fix/DOP on every sample instead of only the one where
      // it changed, so the mapper can read precision per-sample without carrying
      // its own sticky state.
      repeatSticky: true,
      // Drop position samples that imply a jump faster than any vehicle we care
      // about — the same teleportation cap the other parsers use. Acts sample to
      // sample, so it kills GPS glitches without touching a genuinely fast run.
      WrongSpeed: MAX_SPEED_MPS,
      // Pre-Hero8 cameras report altitude against the WGS84 ellipsoid, and the
      // geoid correction needs an optional peer dep (`egm96-universal`) we do not
      // ship. Keep the ellipsoid value rather than logging a failed conversion on
      // every import: altitude here is only ever read as a relative trace.
      ellipsoid: true,
      ...(onProgress ? { progress: onProgress } : {}),
    },
  );

  // The library's own result type is generic over the exact `stream` filter and
  // resolves to a shape that is painful to consume. We asked for a known set of
  // streams; narrow to our own types once, here.
  return result as unknown as GpmfDevices;
}
