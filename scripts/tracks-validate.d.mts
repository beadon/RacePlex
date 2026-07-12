/**
 * Types for the track validator (plan 0008).
 *
 * The validator is plain `.mjs` because it runs in the build script and in CI
 * under bare Node, with no TS toolchain. It is also imported by
 * `src/lib/trackContribution.test.ts`, which asserts that what the app hands a
 * rider is exactly what CI will accept — so it needs types on this side.
 */

export interface TrackRecord {
  name?: string;
  shortName?: string;
  defaultCourse?: string;
  courses?: unknown[];
  meta?: Record<string, unknown>;
}

/** Problems with one track record. Empty means it is good to merge. */
export function validateTrack(track: unknown, file: string): string[];

/** Problems across the whole collection, including cross-track uniqueness. */
export function validateCollection(
  records: Array<{ file: string; track: unknown }>,
): string[];
