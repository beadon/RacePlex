/**
 * RaceChrono CSV v3 preprocessor (issue #33).
 *
 * RaceChrono is the most-used lap timing app in the eskate/motorsport space,
 * and a rider coming from it will have `.csv` exports. We previously asked
 * them to re-export as VBO/NMEA (which we read). This shim reads their v3 CSV
 * directly by rewriting it into a shape the generic CSV importer understands,
 * then handing it off.
 *
 * The v3 export is *almost* a normal CSV, but:
 *   1. It's UTF-8 with BOM.
 *   2. Line 2 is `Format,3` — the reliable format signature.
 *   3. Lines 3-N are metadata key/value pairs (session name, time, etc.).
 *   4. Then THREE header rows: channel names, units, and source device
 *      (`100: gps`, `200: canbus`, `calc`).
 *   5. **Column names are NOT unique.** `speed` appears twice — once from
 *      GPS, once from a calc channel. Keying on name alone loses one.
 *
 * The trap is #5. We fold the source into the column name (`speed@gps`,
 * `speed@calc`) so downstream code sees a normal single-header table with
 * unique columns. The mapper prefers `@gps` columns for lat/lon/speed.
 */

const BOM = "﻿";

/** Strip the BOM and normalise line endings. Returns the array of lines. */
function normaliseLines(text: string): string[] {
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  return clean.split(/\r\n|\n|\r/);
}

/**
 * Detect a RaceChrono CSV v3 export.
 *
 * The sniff is `line 2 = "Format,3"` — cheap and reliable, per the vendor's own
 * export shape. Line 1 is a title (`"Session data"` in current exports), which
 * we don't rely on since it may localise.
 */
export function isRaceChronoCsvV3(content: string): boolean {
  if (typeof content !== "string") return false;
  const lines = normaliseLines(content);
  if (lines.length < 4) return false;
  // Exactly `Format,3` — not `Format,3,extra` (which could match anything). A
  // v3 line has exactly two cells: the literal `Format` and the version `3`.
  return /^Format\s*,\s*3\s*$/.test(lines[1]?.trim() ?? "");
}

/**
 * Rewrite a RaceChrono CSV v3 into a flat single-header CSV that the generic
 * importer can read. Column names disambiguate by device: `speed@gps` vs
 * `speed@calc`, `device_update_rate@gps` vs `device_update_rate@calc`. Unit
 * annotations (row 2 of the three-header block) come along as
 * `column (unit)` so `speedUnitFromHeader` picks them up automatically.
 *
 * If the file doesn't look like v3, throws — call `isRaceChronoCsvV3` first.
 */
export function rewriteRaceChronoCsvV3(content: string): string {
  const lines = normaliseLines(content);
  if (!/^Format\s*,\s*3\b/.test(lines[1]?.trim() ?? "")) {
    throw new Error("Not a RaceChrono CSV v3 export (line 2 != 'Format,3').");
  }

  // Walk past the metadata block until we hit the first triple of consecutive,
  // non-empty rows — those are the name/unit/source header trio. The block
  // between line 2 and the first header row is `key,value` pairs we ignore.
  let i = 2;
  const isBlank = (s: string | undefined) => !s || !s.trim();
  const firstDataCandidateIdx = (() => {
    // Find the first blank line (metadata block terminator in every real export
    // we've seen). If there is none, scan for the first row that has more than
    // 2 columns — the metadata pairs are always exactly 2.
    for (let j = i; j < lines.length; j++) {
      if (isBlank(lines[j])) return j + 1;
    }
    for (let j = i; j < lines.length; j++) {
      const cells = lines[j]?.split(",") ?? [];
      if (cells.length > 2) return j;
    }
    return -1;
  })();
  if (firstDataCandidateIdx === -1 || firstDataCandidateIdx + 3 >= lines.length) {
    throw new Error("RaceChrono CSV v3: no data block found after the metadata pairs.");
  }
  i = firstDataCandidateIdx;

  const names = lines[i]?.split(",").map((c) => c.trim()) ?? [];
  const units = lines[i + 1]?.split(",").map((c) => c.trim()) ?? [];
  const sources = lines[i + 2]?.split(",").map((c) => c.trim()) ?? [];
  if (names.length === 0) throw new Error("RaceChrono CSV v3: empty channel-name row.");

  // Fold source + unit into the column name — but only tag `@source` for the
  // SECOND and later occurrence of each name. The first occurrence keeps its
  // clean name so the generic mapper's aliases (`speed`, `latitude`, `time`)
  // still match. The dupe columns get the disambiguating tag, so nothing is
  // silently dropped (the original bug). Unit annotations always ride along
  // in parens so `speedUnitFromHeader` reads them.
  const nameCounts = new Map<string, number>();
  const foldedHeader = names.map((name, k) => {
    const rawSource = sources[k] ?? "";
    const source = /^\d+\s*:\s*(.+)$/.exec(rawSource)?.[1]?.trim().toLowerCase() ?? rawSource.trim().toLowerCase();
    const unit = units[k] ?? "";
    const count = (nameCounts.get(name) ?? 0) + 1;
    nameCounts.set(name, count);
    // First one keeps its clean name; later dupes get `@source`.
    let key = count === 1 || !source ? name : `${name}@${source}`;
    if (unit) key = `${key} (${unit})`;
    return key;
  });

  const outLines: string[] = [foldedHeader.join(",")];
  for (let j = i + 3; j < lines.length; j++) {
    const line = lines[j];
    if (isBlank(line)) continue;
    outLines.push(line!);
  }
  return outLines.join("\n");
}
