/**
 * GoPro chapter-split folding — parse each chapter and stitch the timelines
 * back into one continuous session (issue #29).
 *
 * The camera splits a long recording into files at a size threshold; each file
 * carries a fresh GPMF timeline starting at 0. Importing them separately gets
 * you N tiny sessions, each cut mid-run. The fix is to rebase every chapter
 * onto the first chapter's clock BEFORE merging: chapter N's `t = 0` sits at
 * the real-world gap between the first and Nth chapters' first GPS fixes.
 *
 * Rebasing by UTC start (not `chapter1.duration + t`) is deliberate — the
 * camera pauses briefly between chapters to close and open the file, so
 * successive chapters aren't strictly contiguous.
 */

import type { GpsSample, ParsedData } from "@/types/racing";
import { calculateBounds } from "../parserUtils";

/**
 * Fold a list of per-chapter ParsedData into one continuous session. The first
 * chapter's samples are kept as-is; each subsequent chapter's samples are
 * shifted by the real-world gap since chapter 1's first fix. When a chapter has
 * no startDate, we fall back to `previousDuration + t` (contiguous assumption).
 *
 * Merged output preserves the first chapter's `startDate`, `fieldMappings`
 * (they're the same shape across chapters — same GPMF streams from one
 * camera), and re-derives `bounds` and `duration` from the folded samples.
 */
export function foldGoProChapters(chapters: ParsedData[]): ParsedData {
  if (chapters.length === 0) {
    throw new Error("foldGoProChapters: no chapters supplied");
  }
  if (chapters.length === 1) return chapters[0];

  const first = chapters[0];
  const firstStartMs = first.startDate?.getTime() ?? 0;

  const samples: GpsSample[] = [...first.samples];
  let lastSampleT = first.samples[first.samples.length - 1]?.t ?? 0;

  for (let i = 1; i < chapters.length; i++) {
    const chapter = chapters[i];
    if (chapter.samples.length === 0) continue;

    // Preferred: rebase by UTC gap since chapter 1's start. Falls back to
    // "immediately after the last sample of the previous chapter" when a
    // chapter has no startDate — closer to right than dropping the chapter,
    // and rare in practice (GoPro fixes always carry UTC).
    let offset: number;
    if (firstStartMs && chapter.startDate) {
      offset = chapter.startDate.getTime() - firstStartMs;
    } else {
      // Add a nominal 1ms nudge so the mapper's "drop backwards steps" guard
      // doesn't discard a chapter whose first sample happens to land at the
      // previous chapter's exact end time.
      offset = lastSampleT + 1;
    }

    for (const s of chapter.samples) {
      samples.push({ ...s, t: s.t + offset });
    }
    lastSampleT = samples[samples.length - 1].t;
  }

  return {
    samples,
    fieldMappings: first.fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    ...(first.startDate ? { startDate: first.startDate } : {}),
    ...(first.dovexMetadata ? { dovexMetadata: first.dovexMetadata } : {}),
  };
}
