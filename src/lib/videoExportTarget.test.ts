/**
 * Unit tests for the video-export target choice + streamed chunk store.
 */

import { describe, it, expect } from "vitest";
import {
  estimateExportBytes,
  shouldStreamExport,
  writeStreamChunk,
  streamedPartsLength,
  STREAMING_SIZE_THRESHOLD_BYTES,
  type StreamedPart,
} from "./videoExportTarget";

/** Assemble the parts into one byte array (what the Blob constructor sees). */
function assemble(parts: StreamedPart[]): Uint8Array {
  const out = new Uint8Array(streamedPartsLength(parts));
  for (const p of parts) out.set(p.data, p.position);
  return out;
}

// ─── shouldStreamExport ─────────────────────────────────────────────────────

describe("shouldStreamExport", () => {
  it("keeps short exports on the in-memory path", () => {
    // 2 minutes at 5 Mbps ≈ 79 MB — well under the threshold.
    expect(shouldStreamExport(120, 5_000_000)).toBe(false);
  });

  it("streams a 20-minute high-quality export (the OOM case)", () => {
    // 20 min at 15 Mbps ≈ 2.2 GB.
    expect(shouldStreamExport(20 * 60, 15_000_000)).toBe(true);
  });

  it("uses the size estimate against the threshold", () => {
    const justUnder = (STREAMING_SIZE_THRESHOLD_BYTES * 8) / 15_128_000 / 1.05 - 1;
    expect(estimateExportBytes(justUnder, 15_000_000)).toBeLessThan(STREAMING_SIZE_THRESHOLD_BYTES);
    expect(shouldStreamExport(justUnder, 15_000_000)).toBe(false);
    expect(shouldStreamExport(justUnder + 10, 15_000_000)).toBe(true);
  });
});

// ─── writeStreamChunk ───────────────────────────────────────────────────────

describe("writeStreamChunk", () => {
  it("appends sequential writes", () => {
    const parts: StreamedPart[] = [];
    writeStreamChunk(parts, new Uint8Array([1, 2, 3]), 0);
    writeStreamChunk(parts, new Uint8Array([4, 5]), 3);
    expect(streamedPartsLength(parts)).toBe(5);
    expect(Array.from(assemble(parts))).toEqual([1, 2, 3, 4, 5]);
  });

  it("applies an in-place back-patch over existing parts", () => {
    const parts: StreamedPart[] = [];
    writeStreamChunk(parts, new Uint8Array([1, 2, 3, 4]), 0);
    writeStreamChunk(parts, new Uint8Array([5, 6]), 4);
    // Patch bytes 2..5 (spans both parts).
    writeStreamChunk(parts, new Uint8Array([9, 9, 9]), 2);
    expect(Array.from(assemble(parts))).toEqual([1, 2, 9, 9, 9, 6]);
    expect(streamedPartsLength(parts)).toBe(6);
  });

  it("handles a write that overlaps the end and extends the file", () => {
    const parts: StreamedPart[] = [];
    writeStreamChunk(parts, new Uint8Array([1, 2, 3]), 0);
    writeStreamChunk(parts, new Uint8Array([7, 8, 9]), 2); // overwrites byte 2, appends 2 more
    expect(Array.from(assemble(parts))).toEqual([1, 2, 7, 8, 9]);
  });

  it("zero-fills a gap so the file stays well-formed", () => {
    const parts: StreamedPart[] = [];
    writeStreamChunk(parts, new Uint8Array([1]), 0);
    writeStreamChunk(parts, new Uint8Array([5]), 3);
    expect(Array.from(assemble(parts))).toEqual([1, 0, 0, 5]);
  });

  it("copies the incoming buffer (muxer may reuse it)", () => {
    const parts: StreamedPart[] = [];
    const buf = new Uint8Array([1, 2, 3]);
    writeStreamChunk(parts, buf, 0);
    buf[0] = 99;
    expect(Array.from(assemble(parts))).toEqual([1, 2, 3]);
  });
});
