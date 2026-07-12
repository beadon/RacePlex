/**
 * Pure helpers for the video-export muxer target choice and the streamed
 * chunk store behind it.
 *
 * Short exports keep the old in-memory path (single buffer, in-memory
 * fastStart → maximally compatible MP4). Long exports would need that single
 * contiguous ArrayBuffer to grow to the full file size (a 20-min 15 Mbps
 * export ≈ 2.2 GB — guaranteed mobile OOM), so they switch to a chunked
 * stream target with fragmented MP4 output: the muxer emits ~16 MiB pieces
 * that are collected and handed to the Blob constructor, which lets the
 * browser back the result with disk instead of one giant heap allocation.
 */

/** Estimated output size above which the export streams instead of buffering. */
export const STREAMING_SIZE_THRESHOLD_BYTES = 350 * 1024 * 1024;

/** Audio bitrate used by the export pipeline (AAC-LC). */
const AUDIO_BITRATE = 128_000;

/** Rough output size for a given duration and video bitrate, in bytes. */
export function estimateExportBytes(durationSec: number, videoBitrate: number): number {
  // ~5% container overhead on top of the elementary streams.
  return ((videoBitrate + AUDIO_BITRATE) / 8) * durationSec * 1.05;
}

/** Whether an export of this duration/bitrate should use the streamed target. */
export function shouldStreamExport(
  durationSec: number,
  videoBitrate: number,
  thresholdBytes: number = STREAMING_SIZE_THRESHOLD_BYTES,
): boolean {
  return estimateExportBytes(durationSec, videoBitrate) > thresholdBytes;
}

/** One contiguous piece of the streamed output file. */
export interface StreamedPart {
  position: number;
  data: Uint8Array;
}

/**
 * Apply a muxer write to the part list. Fragmented MP4 writes are
 * append-only in practice, but this also handles in-place back-patches and
 * (defensively) zero-fills gaps, so the assembled file is always well-formed.
 * Parts are kept contiguous from position 0 in ascending order.
 */
export function writeStreamChunk(parts: StreamedPart[], data: Uint8Array, position: number): void {
  const last = parts[parts.length - 1];
  const total = last ? last.position + last.data.length : 0;

  // Overwrite any overlap with already-stored parts (back-patch).
  if (position < total) {
    for (const part of parts) {
      const start = Math.max(position, part.position);
      const end = Math.min(position + data.length, part.position + part.data.length);
      if (start >= end) continue;
      part.data.set(data.subarray(start - position, end - position), start - part.position);
    }
  }

  // Zero-fill a gap (should not happen with fragmented output, but never
  // produce a corrupt file if it does).
  if (position > total) {
    parts.push({ position: total, data: new Uint8Array(position - total) });
  }

  // Append whatever extends beyond the current end.
  const writeEnd = position + data.length;
  if (writeEnd > total) {
    const tailStart = Math.max(position, total);
    parts.push({ position: tailStart, data: data.slice(tailStart - position) });
  }
}

/** Total assembled size of the part list, in bytes. */
export function streamedPartsLength(parts: StreamedPart[]): number {
  const last = parts[parts.length - 1];
  return last ? last.position + last.data.length : 0;
}
