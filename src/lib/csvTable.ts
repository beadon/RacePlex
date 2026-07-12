/**
 * A generic delimited-table reader.
 *
 * Every telemetry app in the eskate/PEV world emits its own CSV layout, and there are more of them
 * than there are of us. Writing a bespoke parser per format is a losing game, because the one thing
 * they all have in common is that **their column sets are not stable**:
 *
 *   - pOnewheel generates its columns PER RIDE, from whichever BLE attributes that ride recorded.
 *     A fixed column map for it is impossible by construction.
 *   - Float Control reorders columns between app versions (we have two real exports where ADC1/ADC2
 *     sit at positions 6-7 in one and 18-19 in the other).
 *   - TrackAddict's columns depend on which sensors and OBD-II PIDs the user switched on.
 *   - VESC has two dialects, and third-party apps emit subsets of it in different orders.
 *
 * So this reads a table by NAME, never by position, and treats the header as the source of truth.
 * A format "profile" (see vescCsvParser.ts) is then just a set of column aliases plus units — not a
 * parser. Adding a device becomes a data change, not a code change.
 *
 * This module deliberately knows nothing about GPS, laps or telemetry. It turns bytes into a table.
 */

/** One parsed table: the header names, and the rows as raw strings. */
export interface CsvTable {
  /** Column names, in file order, with any empty trailing column dropped. */
  columns: string[];
  /** Data rows. Each row has `columns.length` entries (short rows are padded with ''). */
  rows: string[][];
  /** Lines before the header that began with `#` — TrackAddict hides real metadata in these. */
  comments: string[];
  /** Which delimiter we settled on. Useful for diagnostics and for tests. */
  delimiter: string;
}

const DELIMITERS = [';', ',', '\t', '|'] as const;

/**
 * Pick the delimiter by counting candidates in the header line and taking the winner.
 *
 * VESC uses `;`. Most others use `,`. Counting beats guessing, and it is what vesc_tool's own
 * reader does (it falls back to `,` when `;` yields a single token).
 */
export function detectDelimiter(headerLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    // Count only outside quotes, so a quoted "Smith, John" doesn't win the vote for ','.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < headerLine.length; i++) {
      const ch = headerLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === d) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Split one line on `delimiter`, honouring double-quoted fields. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Normalise a header token to its channel key.
 *
 * Handles the VESC Express / SD-card dialect, whose header tokens are
 * `key:name:unit:precision:isRelative:isTimestamp` — e.g. `kmh_gnss:Speed GNSS:km/h:1:0:0`. The
 * plain vesc_tool RT log instead writes bare names (`gnss_gVel`). vesc_tool itself tells the two
 * apart by whether the first token contains a colon, and so do we.
 *
 * A bare `Altitude (m)` keeps its parenthetical here — the unit in the name is often the ONLY
 * record of the unit (see Float Control's `Speed(km/h)` vs `Speed(mph)`), so callers get the raw
 * name and decide.
 */
function headerKey(token: string): string {
  const t = token.trim();
  if (!t.includes(':')) return t;
  // Only treat as the tagged dialect if the part before ':' looks like an identifier.
  const [key] = t.split(':');
  return /^[A-Za-z_][\w-]*$/.test(key) ? key : t;
}

export interface ParseTableOptions {
  /** Force a delimiter instead of sniffing (tests, or a profile that knows). */
  delimiter?: string;
  /**
   * Predicate that recognises the header row. Defaults to "the first non-comment, non-blank line".
   * RaceBox's CSV, for instance, hides its header below a metadata block.
   */
  isHeader?: (cells: string[]) => boolean;
}

/**
 * Read delimited text into a table.
 *
 * Skips (but keeps) leading `#` comment lines — TrackAddict's preamble carries the app version and
 * the course end point, and its first line is a reliable format signature.
 */
export function parseCsvTable(text: string, options: ParseTableOptions = {}): CsvTable {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const lines = clean.split(/\r\n|\n|\r/);

  const comments: string[] = [];
  let headerIdx = -1;
  let delimiter = options.delimiter ?? ',';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      comments.push(line);
      continue;
    }

    if (!options.delimiter) delimiter = detectDelimiter(line);
    const cells = splitDelimited(line, delimiter).map((c) => c.trim());

    if (!options.isHeader || options.isHeader(cells)) {
      headerIdx = i;
      break;
    }
    // Not the header yet (metadata block) — keep looking.
  }

  if (headerIdx === -1) {
    throw new Error('CSV: no header row found');
  }

  const columns = splitDelimited(lines[headerIdx]!, delimiter).map((c) => headerKey(c));

  // A trailing delimiter yields a phantom empty column. VESC ends every line with ';', so a naive
  // split gives 56 tokens for 55 columns — and then every positional index is off by one at the end.
  while (columns.length > 0 && columns[columns.length - 1] === '') columns.pop();

  const rows: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !line.trim() || line.startsWith('#')) continue;

    const cells = splitDelimited(line, delimiter);
    // Pad short rows, truncate long ones (the trailing-delimiter phantom again).
    while (cells.length < columns.length) cells.push('');
    rows.push(cells.slice(0, columns.length));
  }

  return { columns, rows, comments, delimiter };
}

/**
 * Name-based column lookup, insensitive to case, spaces, underscores, hyphens and any trailing
 * parenthetical unit. So `gnss_lat`, `GPS-Lat`, `gps_lat` and `Latitude` are all reachable, and
 * `Altitude (m)` matches a request for `altitude`.
 */
export function columnIndex(columns: string[], ...aliases: string[]): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[\s_\-.]/g, '')
      .trim();

  const normalized = columns.map(norm);
  for (const alias of aliases) {
    const i = normalized.indexOf(norm(alias));
    if (i !== -1) return i;
  }
  return -1;
}

/** Numeric cell, or undefined when blank/non-numeric. Strips a trailing '%' (Float Control). */
export function cellNumber(row: string[], index: number): number | undefined {
  if (index < 0) return undefined;
  const raw = row[index];
  if (raw === undefined) return undefined;
  const v = raw.trim().replace(/%$/, '');
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
