/**
 * Distinct GPS fixes, and positions interpolated between them.
 *
 * Most PEV loggers do not log GPS at the rate they log everything else. A VESC writes the ESC at
 * ~12 Hz and the GNSS at ~1 Hz; TrackAddict writes accelerometer + OBD at 10-50 Hz and the phone's
 * GPS at 1 Hz; pOnewheel is the same story over BLE. The GPS columns therefore REPEAT: the same
 * lat/lon is written to every row until the next fix lands.
 *
 * Import that naively and every position is a staircase and every derived speed is a sawtooth.
 *
 * The obvious fix — keep one sample per GPS fix — is WRONG, and it is worth saying why, because it
 * is the trap. Dropping to the GNSS rate ALSO drops the fast channels to 1 Hz, and those channels
 * are the entire reason to import a VESC/TrackAddict log rather than a GPX of the same ride. A
 * nosedive IS a duty-cycle spike lasting a fraction of a second. At 1 Hz you cannot see one.
 *
 * So: keep EVERY row at full rate, and INTERPOLATE the position between fixes.
 *
 * Straight-line interpolation across a ~1 s gap is a real approximation — a rider carving a corner
 * will cut it slightly. But it is a far better one than repeating the last fix, which produces a
 * track that teleports once a second. Over a 1 s gap at eskate speeds this is a few metres of chord
 * error at worst, and it is smooth, which is what the map and the charts need.
 */

import { validateGpsCoords } from './parserUtils';

/** One genuine GPS fix: the row it first appeared on, its time, and where it was. */
export interface GpsFixAnchor {
  /** Index of the first row carrying this fix — the row where it is genuinely current. */
  row: number;
  /** Elapsed milliseconds at that row. */
  t: number;
  lat: number;
  lon: number;
}

export interface CollectAnchorsOptions {
  /** How many rows there are. */
  rowCount: number;
  /** Elapsed ms per row (same length as rowCount). */
  times: number[];
  /** Latitude of row i, or undefined when the cell is blank/non-numeric. */
  lat: (i: number) => number | undefined;
  lon: (i: number) => number | undefined;
  /**
   * Identity of the fix carried by row i. Rows sharing a key carry the SAME fix, so only the first
   * is an anchor. Defaults to the raw lat/lon pair, which is what you want when the log has no
   * better signal; a log that publishes one (VESC's `gnss_posTime`, TrackAddict's `GPS_Update`
   * flag) should supply it, because two consecutive fixes CAN legitimately be identical when the
   * rider is stationary.
   */
  fixKey?: (i: number) => string;
}

/**
 * The rows where a NEW GPS fix arrived. Rows before lock (lat/lon exactly 0) and out-of-range
 * coordinates are skipped — they are not fixes.
 */
export function collectGpsAnchors(options: CollectAnchorsOptions): GpsFixAnchor[] {
  const { rowCount, times, lat, lon, fixKey } = options;
  const anchors: GpsFixAnchor[] = [];
  let lastKey: string | undefined;

  for (let i = 0; i < rowCount; i++) {
    const la = lat(i);
    const lo = lon(i);
    if (la === undefined || lo === undefined) continue;
    // Loggers record rows before GPS lock with lat/lon at exactly 0.
    if (validateGpsCoords(la, lo) !== null) continue;

    const key = fixKey ? fixKey(i) : `${la},${lo}`;
    if (key === lastKey) continue;
    lastKey = key;

    anchors.push({ row: i, t: times[i] ?? 0, lat: la, lon: lo });
  }

  return anchors;
}

/**
 * A position lookup that linearly interpolates between the surrounding anchors.
 *
 * Keeps a monotone cursor, so walking the rows in order costs O(1) per row rather than a binary
 * search on a long log; going backwards is still correct, just slower.
 */
export function createPositionInterpolator(
  anchors: GpsFixAnchor[],
): (t: number) => { lat: number; lon: number } {
  let hint = 0;

  return (t: number) => {
    if (anchors.length === 0) return { lat: 0, lon: 0 };

    if (t < (anchors[hint]?.t ?? 0)) hint = 0;
    while (hint + 1 < anchors.length && anchors[hint + 1]!.t <= t) hint++;

    const a = anchors[Math.min(hint, anchors.length - 1)]!;
    const b = anchors[Math.min(hint + 1, anchors.length - 1)]!;
    if (b === a || b.t <= a.t) return { lat: a.lat, lon: a.lon };

    const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u };
  };
}
