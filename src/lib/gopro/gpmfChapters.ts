/**
 * GoPro chapter grouping — pure filename math (issue #29).
 *
 * A long GoPro recording is split by the camera into multiple files following
 * a fixed naming convention:
 *
 *     G<H|X|L><chapter><scene>.MP4
 *   e.g. `GX010042.MP4`  →  chapter 01, scene 0042
 *        `GX020042.MP4`  →  chapter 02, scene 0042  (same recording)
 *        `GX010043.MP4`  →  chapter 01, scene 0043  (different recording)
 *
 * `GH` = HERO 4-6, `GX` = HERO 7+, `GL` = HERO12 (low-power 360). Older HEROs
 * used `GOPR0042.MP4` for the first chapter and switched to `GP01` etc. for
 * chapters 2+ — we handle that too, but every recent camera uses `GX*`.
 *
 * The scene id groups files that belong together; the chapter id orders them.
 * This module JUST does the string math — the folding of parsed timelines
 * lives in `gpmfImporter.ts`.
 */

/** One chapter of a GoPro recording. `chapter` starts at 1. */
export interface GoProChapterInfo {
  /** GoPro camera prefix (`GX`, `GH`, `GL`, `GOPR`, `GP`). Uppercase. */
  prefix: string;
  /** Chapter number (1-based). Files in the same recording share `scene`. */
  chapter: number;
  /** Scene id — the same for every chapter of one recording. */
  scene: string;
  /** File extension (case preserved). */
  ext: string;
}

/**
 * Parse a GoPro chapter filename, or return null if it doesn't match the
 * convention. Matches on the filename only — the caller is expected to have
 * already established the file is a GoPro video (extension / ftyp magic).
 *
 * Recognised patterns (case-insensitive):
 *   - `GX<CC><SSSS>.<ext>` — HERO 7+   (CC = chapter, SSSS = scene)
 *   - `GH<CC><SSSS>.<ext>` — HERO 4-6
 *   - `GL<CC><SSSS>.<ext>` — HERO12 low-power 360
 *   - `GOPR<SSSS>.<ext>`   — HERO 3+ chapter 1 (chapter = 1)
 *   - `GP<CC><SSSS>.<ext>` — HERO 3+ chapters 2+ (chapter = CC)
 */
export function parseGoProChapterName(fileName: string): GoProChapterInfo | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const m = /^(GX|GH|GL)(\d{2})(\d{4})(\.[^.]+)$/i.exec(base);
  if (m) {
    return {
      prefix: m[1].toUpperCase(),
      chapter: parseInt(m[2], 10),
      scene: m[3],
      ext: m[4],
    };
  }
  const legacyFirst = /^(GOPR)(\d{4})(\.[^.]+)$/i.exec(base);
  if (legacyFirst) {
    return {
      prefix: legacyFirst[1].toUpperCase(),
      chapter: 1,
      scene: legacyFirst[2],
      ext: legacyFirst[3],
    };
  }
  const legacyRest = /^(GP)(\d{2})(\d{4})(\.[^.]+)$/i.exec(base);
  if (legacyRest) {
    return {
      prefix: legacyRest[1].toUpperCase(),
      chapter: parseInt(legacyRest[2], 10),
      scene: legacyRest[3],
      ext: legacyRest[4],
    };
  }
  return null;
}

/**
 * Group a batch of files by their GoPro chapter-group id (scene + extension).
 * Files that don't match the naming convention are returned as their own
 * single-file group. Groups are sorted by chapter number; siblings from the
 * same recording end up in the same group in reading order.
 */
export function groupGoProChapters(files: File[]): File[][] {
  const grouped = new Map<string, Array<{ file: File; chapter: number }>>();
  const singletons: File[][] = [];

  for (const file of files) {
    const info = parseGoProChapterName(file.name);
    if (!info) {
      singletons.push([file]);
      continue;
    }
    // `GOPR` and `GP` share a scene id (legacy chapter 1 vs 2+); collapse
    // them under one key so a `GOPR0042.MP4` + `GP020042.MP4` selection folds.
    const bucket = info.prefix === "GP" || info.prefix === "GOPR"
      ? `legacy:${info.scene}${info.ext.toLowerCase()}`
      : `${info.prefix}:${info.scene}${info.ext.toLowerCase()}`;
    const list = grouped.get(bucket) ?? [];
    list.push({ file, chapter: info.chapter });
    grouped.set(bucket, list);
  }

  const chapterGroups: File[][] = [];
  for (const entries of grouped.values()) {
    entries.sort((a, b) => a.chapter - b.chapter);
    chapterGroups.push(entries.map((e) => e.file));
  }
  return [...chapterGroups, ...singletons];
}
