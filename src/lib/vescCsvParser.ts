/**
 * VESC Tool CSV.
 *
 * This is the format that matters most to RacePlex, because until now **no eskate app could talk to
 * us at all** — not VESC Tool, not FreeSK8, not Metr, not Float Control, not the official Onewheel
 * app. Every one of them logs GPS into a layout we rejected. For an app aimed at eskate riders,
 * that was the gap.
 *
 * And VESC is more than reach. It is the one format that puts **motor current, battery sag, duty
 * cycle and ERPM on the same timeline as GPS** — which is the thing no car-oriented lap timer can
 * do, and the reason an eskate-specific tool deserves to exist. A nosedive is not a GPS event; it
 * is a duty-cycle event that a GPS trace only sees the aftermath of.
 *
 * Schema confirmed from the writer itself: vedderb/vesc_tool, `vescinterface.cpp` (header emitter
 * lines 1772-1829, row emitter 468-526). Verified against a real Onewheel ride.
 *
 * ┌─ FOUR THINGS THE INTERNET WILL TELL YOU THAT ARE WRONG ────────────────────────────────────┐
 * │                                                                                             │
 * │ 1. There is NO `kmh_gnss` column. It is widely cited, but it is one of vesc_tool's internal │
 * │    *display* names (pageloganalysis.cpp), not something written to disk. The real column is │
 * │    `gnss_gVel`, and it is in METRES PER SECOND, not km/h. Same story for `trip_gnss`        │
 * │    (derived, not stored) and `gnss_h_acc` (actually `gnss_hAcc`).                           │
 * │                                                                                             │
 * │ 2. The GPS repeats. The ESC logs at ~12 Hz but the GNSS only fixes at ~1 Hz, so lat/lon sit │
 * │    unchanged across a dozen consecutive rows. Import them naively and every position is a   │
 * │    staircase and every derived speed is a sawtooth.                                         │
 * │                                                                                             │
 * │    The obvious fix — keep one sample per GPS fix — is WRONG, and it is worth saying why,    │
 * │    because it is the trap. Dropping to the GNSS rate ALSO drops the ESC channels to 1 Hz,   │
 * │    and those channels are the entire reason to import a VESC log rather than a GPX of the   │
 * │    same ride. A nosedive IS a duty-cycle spike. At 1 Hz you cannot see one.                 │
 * │                                                                                             │
 * │    So: keep EVERY ESC row at full rate, and INTERPOLATE the position between fixes. Full    │
 * │    12 Hz motor data, and a smooth track.                                                    │
 * │                                                                                             │
 * │ 3. The line ends with a trailing `;`, so a naive split yields one more token than there are │
 * │    columns. Handled in csvTable.ts.                                                         │
 * │                                                                                             │
 * │ 4. Do NOT parse by position, even though vesc_tool's own reader does. Third-party apps      │
 * │    (Float Control, Floaty) emit SUBSETS of these columns in DIFFERENT orders. Positional    │
 * │    parsing silently produces garbage on those — which is worse than failing.                │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 */

import { GpsSample, ParsedData } from '@/types/racing';
import { calculateBounds, speedTriple } from './parserUtils';
import { cellNumber, columnIndex, parseCsvTable, type CsvTable } from './csvTable';
import { collectGpsAnchors, createPositionInterpolator } from './gpsFixes';

/** Channels we lift out of the ESC side of the log and put on the chart next to GPS. */
const ESC_CHANNELS: { aliases: string[]; label: string; index: number }[] = [
  { aliases: ['erpm'], label: 'ERPM', index: -40 },
  { aliases: ['duty_cycle'], label: 'Duty Cycle', index: -41 },
  { aliases: ['input_voltage'], label: 'Battery Voltage (V)', index: -42 },
  { aliases: ['current_motor'], label: 'Motor Current (A)', index: -43 },
  { aliases: ['current_in'], label: 'Battery Current (A)', index: -44 },
  { aliases: ['temp_motor'], label: 'Motor Temp (C)', index: -45 },
  { aliases: ['temp_mos_max', 'temp_mos'], label: 'ESC Temp (C)', index: -46 },
  { aliases: ['battery_level'], label: 'Battery Level', index: -47 },
  { aliases: ['fault_code'], label: 'Fault Code', index: -48 },
  { aliases: ['pitch'], label: 'Pitch (deg)', index: -49 },
];

/**
 * A VESC log is recognised by its GNSS column names, which are distinctive enough that nothing else
 * uses them. We deliberately do NOT sniff on the delimiter or the ESC columns: Float Control and
 * Floaty emit VESC-ish subsets, and we want those to reach this parser too.
 */
export function isVescCsvFormat(content: string): boolean {
  const head = content.slice(0, 4000);
  const firstLine = head.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  const lower = firstLine.toLowerCase();
  // Either dialect: bare `gnss_lat` (RT log) or tagged `gnss_lat:Latitude:deg:...` (VESC Express).
  return lower.includes('gnss_lat') && lower.includes('gnss_lon');
}

/**
 * The timebase.
 *
 * `ms_today` is milliseconds since local midnight — not an epoch, and it wraps at midnight. We only
 * ever use it as a difference from the first row, so the wrap is the only thing worth handling.
 */
function elapsedMs(table: CsvTable, timeIdx: number): number[] {
  const out: number[] = [];
  let wraps = 0;
  let prev: number | undefined;

  for (const row of table.rows) {
    let t = cellNumber(row, timeIdx) ?? 0;
    if (prev !== undefined && t + wraps * 86_400_000 < prev - 1000) wraps++;
    t += wraps * 86_400_000;
    prev = t;
    out.push(t);
  }

  const t0 = out[0] ?? 0;
  return out.map((t) => t - t0);
}

export function parseVescCsvFile(content: string): ParsedData {
  const table = parseCsvTable(content);

  const cLat = columnIndex(table.columns, 'gnss_lat', 'lat', 'latitude');
  const cLon = columnIndex(table.columns, 'gnss_lon', 'lon', 'long', 'longitude');
  if (cLat === -1 || cLon === -1) {
    throw new Error('VESC CSV: no gnss_lat / gnss_lon columns');
  }

  const cPosTime = columnIndex(table.columns, 'gnss_posTime');
  const cTime = columnIndex(table.columns, 'ms_today');
  const cAlt = columnIndex(table.columns, 'gnss_alt');
  const cSpeed = columnIndex(table.columns, 'gnss_gVel'); // metres per second
  const cHAcc = columnIndex(table.columns, 'gnss_hAcc');
  const cEscSpeed = columnIndex(table.columns, 'speed_meters_per_sec');

  const times = cTime !== -1 ? elapsedMs(table, cTime) : table.rows.map((_, i) => i * 100);

  const escChannels = ESC_CHANNELS.map((c) => ({
    ...c,
    col: columnIndex(table.columns, ...c.aliases),
  })).filter((c) => c.col !== -1);

  // ── Pass 1: find the DISTINCT GPS fixes, and when each one actually arrived. ────────────────
  //
  // A fix is written to every ESC row until the next one lands, so the first row carrying a new
  // `gnss_posTime` is the row where that fix is genuinely current. Those are our anchors.
  // (Shared with the generic CSV importer — see gpsFixes.ts for why interpolation, not decimation.)
  const anchors = collectGpsAnchors({
    rowCount: table.rows.length,
    times,
    lat: (i) => cellNumber(table.rows[i]!, cLat),
    lon: (i) => cellNumber(table.rows[i]!, cLon),
    fixKey:
      cPosTime !== -1
        ? (i) => table.rows[i]![cPosTime] ?? ''
        : (i) => `${table.rows[i]![cLat]},${table.rows[i]![cLon]}`,
  });

  if (anchors.length === 0) {
    throw new Error('VESC CSV: no GPS fixes found (was the GNSS module connected?)');
  }

  const positionAt = createPositionInterpolator(anchors);

  // ── Pass 2: emit EVERY ESC row, with an interpolated position. ──────────────────────────────
  //
  // This is the whole point. Keeping only the GPS fixes would drop the ESC channels from ~12 Hz to
  // ~1 Hz — and a nosedive is a duty-cycle spike that lasts a fraction of a second. At 1 Hz you
  // simply cannot see one, which would make the import worthless for the exact thing it is for.
  //
  // Rows AFTER the last GPS fix have nothing to interpolate toward, so we clamp them to the last
  // known position rather than dropping them — same policy as genericCsvParser (see issue #30).
  const samples: GpsSample[] = [];
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;

  for (let i = first.row; i < table.rows.length; i++) {
    const row = table.rows[i]!;
    const t = times[i] ?? 0;

    const { lat, lon } = i <= last.row ? positionAt(t) : { lat: last.lat, lon: last.lon };

    // gnss_gVel is m/s. (Confirmed against the real log: its ratio to speed derived from the
    // positions is 0.974, i.e. 1.0 — not 3.6.) It only updates at the GNSS rate, so fall back to
    // the ESC's own speed estimate, which is also m/s and updates every row.
    const speedMps = cellNumber(row, cEscSpeed) ?? cellNumber(row, cSpeed) ?? 0;

    const extraFields: Record<string, number> = {};
    const alt = cellNumber(row, cAlt);
    if (alt !== undefined) extraFields['Altitude (m)'] = alt;
    const hAcc = cellNumber(row, cHAcc);
    if (hAcc !== undefined) extraFields['GPS Accuracy (m)'] = hAcc;

    for (const ch of escChannels) {
      const v = cellNumber(row, ch.col);
      if (v !== undefined) extraFields[ch.label] = v;
    }

    samples.push({
      t,
      lat,
      lon,
      ...speedTriple(Math.max(0, speedMps)),
      extraFields,
    });
  }

  const has = (key: string) => samples.some((s) => s.extraFields[key] !== undefined);
  const fieldMappings = [
    { index: -1, name: 'Speed', enabled: true },
    ...(has('Altitude (m)') ? [{ index: -3, name: 'Altitude (m)', enabled: true }] : []),
    // ESC channels default to ENABLED — they are the entire reason to import a VESC log rather
    // than a GPX of the same ride. Seeing motor current next to speed is the point.
    ...escChannels
      .filter((c) => has(c.label))
      .map((c) => ({ index: c.index, name: c.label, enabled: true })),
    ...(has('GPS Accuracy (m)')
      ? [{ index: -50, name: 'GPS Accuracy (m)', enabled: false }]
      : []),
  ];

  // NOTE: deliberately no parserStats. Rows before GPS lock are not "rejected" — they are simply
  // outside the ride, and the rows carrying a repeated fix are not rejected either; they are kept,
  // with an interpolated position. Reporting them as rejections (an earlier version of this parser
  // did, as "368 short-row rejections") tells the rider their file is broken when it is fine.
  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1]!.t,
  };
}
