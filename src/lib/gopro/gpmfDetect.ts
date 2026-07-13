// Format detection for GoPro videos — deliberately its own module, and the ONLY
// part of the GoPro importer the format router imports eagerly.
//
// Everything else (the mapper, and the two libraries behind it — mp4box +
// binary-parser, ~230 kB) hangs off a dynamic import in `datalogParser.ts`, so a
// user who never drops a video never downloads a byte of it. Keep this file free
// of imports: anything reachable from here is in the main bundle.

/** Container extensions that can carry a GPMF track. `.lrv` is GoPro's low-res proxy. */
const GOPRO_EXTENSIONS = [".mp4", ".mov", ".lrv"] as const;

/** ISO-BMFF magic: bytes 4..7 of any mp4/mov are the `ftyp` box type. */
const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp"

/**
 * Detect a video container that might carry GoPro telemetry.
 *
 * Extension first; failing that, the `ftyp` magic catches a renamed file. We claim
 * ANY mp4/mov, not just GoPro's — there is no cheap way to know whether a `gpmd`
 * track is present without demuxing the container, and a non-GoPro video would
 * otherwise fall through to the text parsers and produce nonsense. A video with no
 * telemetry then fails with a message that says exactly that.
 */
export function isGoProFile(fileName: string, buffer?: ArrayBuffer): boolean {
  const lower = fileName.toLowerCase();
  if (GOPRO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;

  if (buffer && buffer.byteLength >= 8) {
    const head = new Uint8Array(buffer, 4, 4);
    if (FTYP.every((b, i) => head[i] === b)) return true;
  }
  return false;
}
