/**
 * Pure alignment for cross-session comparison (plan 0012 / issue #37).
 *
 * Given each session's ParsedData + a chosen lap, produce a per-session sample
 * subset re-parameterised by *distance from lap start*. That's the axis riders
 * intuit ("where on the track") — comparing by clock time is meaningless when
 * two laps have different total durations.
 *
 * The resample buckets N equally-spaced distance samples across the lap;
 * every channel (speed, altitude, g-force, whatever) gets sampled at the same
 * distance points. The resulting parallel arrays feed directly into the
 * multi-series chart layer without further alignment work at the render step.
 */

import type { GpsSample, Lap, ParsedData } from "@/types/racing";
import { haversineDistance } from "../parserUtils";

/** How many equally-spaced distance points we resample each lap onto. */
export const COMPARISON_SAMPLE_COUNT = 200;

/** One session's contribution to the comparison. */
export interface AlignedSeries {
  /** File name — stable id for colour + display. */
  fileName: string;
  /** The lap picked from this session. `null` when no laps could be found. */
  lap: Lap | null;
  /** Distance in metres from lap start, monotonically increasing. */
  distances: number[];
  /**
   * Every channel value at each distance point. Keys are channel ids (from
   * `channels.ts`) or `custom:*` slugs, matching what `ParsedData.samples`
   * carry in `extraFields`. `speedMps` is added under the key `"speedMps"`
   * because it's a first-class field on `GpsSample`, not in `extraFields`.
   */
  channels: Record<string, number[]>;
  /**
   * Elapsed time from lap start in ms, at each distance point. Useful when
   * the chart displays a time axis instead of distance.
   */
  timeMs: number[];
  /** Total distance covered in the lap, metres — for the chart's x-axis cap. */
  totalDistanceM: number;
  /** Lap time in ms — for the header + delta calculations. */
  lapTimeMs: number;
}

/** Pick the fastest lap (by `lapTimeMs`) — the natural default comparison. */
export function pickFastestLap(laps: Lap[]): Lap | null {
  if (laps.length === 0) return null;
  return laps.reduce((best, l) => (l.lapTimeMs < best.lapTimeMs ? l : best));
}

/**
 * Cumulative distance array for a run of samples, m. `dist[0]` is 0; each
 * subsequent entry is the previous plus the haversine step to that sample.
 */
function cumulativeDistances(samples: GpsSample[]): number[] {
  const out = new Array<number>(samples.length);
  out[0] = 0;
  for (let i = 1; i < samples.length; i++) {
    out[i] = out[i - 1] + haversineDistance(
      samples[i - 1].lat, samples[i - 1].lon,
      samples[i].lat, samples[i].lon,
    );
  }
  return out;
}

/** Linear interpolation at `x` between two indexed samples, returning y. */
function interp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 <= x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * Build the aligned series for one session. Returns null when the session
 * has no laps (skipped in the chart layer). When `lap` isn't specified, the
 * session's fastest lap is used.
 */
export function alignSessionToLap(
  fileName: string,
  data: ParsedData,
  laps: Lap[],
  lap: Lap | null = pickFastestLap(laps),
  sampleCount: number = COMPARISON_SAMPLE_COUNT,
): AlignedSeries | null {
  if (!lap) {
    return {
      fileName, lap: null,
      distances: [], channels: {}, timeMs: [],
      totalDistanceM: 0, lapTimeMs: 0,
    };
  }
  const s0 = lap.startIndex;
  const s1 = lap.endIndex;
  if (s0 < 0 || s1 <= s0 || s1 >= data.samples.length) return null;

  const lapSamples = data.samples.slice(s0, s1 + 1);
  if (lapSamples.length < 2) return null;

  const cumDist = cumulativeDistances(lapSamples);
  const totalDist = cumDist[cumDist.length - 1];
  if (!Number.isFinite(totalDist) || totalDist <= 0) return null;

  // Every extra-field key seen in this lap. We resample each one at the same
  // distance points; missing values on individual samples are left as NaN
  // (an isolated NaN in the chart is drawn as a gap, not a zero).
  const extraKeys = new Set<string>();
  for (const s of lapSamples) {
    for (const k of Object.keys(s.extraFields)) extraKeys.add(k);
  }

  const distances = new Array<number>(sampleCount);
  const timeMs = new Array<number>(sampleCount);
  const channels: Record<string, number[]> = {
    speedMps: new Array<number>(sampleCount),
  };
  for (const k of extraKeys) channels[k] = new Array<number>(sampleCount);

  const t0 = lapSamples[0].t;
  let cursor = 0;

  for (let i = 0; i < sampleCount; i++) {
    const target = (i / (sampleCount - 1)) * totalDist;
    while (cursor < cumDist.length - 2 && cumDist[cursor + 1] < target) cursor++;
    const d0 = cumDist[cursor];
    const d1 = cumDist[cursor + 1] ?? d0;
    const a = lapSamples[cursor];
    const b = lapSamples[cursor + 1] ?? a;

    distances[i] = target;
    timeMs[i] = interp(d0, a.t - t0, d1, b.t - t0, target);
    channels.speedMps[i] = interp(d0, a.speedMps, d1, b.speedMps, target);
    for (const k of extraKeys) {
      const va = a.extraFields[k];
      const vb = b.extraFields[k];
      if (va === undefined || vb === undefined) {
        channels[k][i] = NaN;
      } else {
        channels[k][i] = interp(d0, va, d1, vb, target);
      }
    }
  }

  return {
    fileName, lap,
    distances, channels, timeMs,
    totalDistanceM: totalDist,
    lapTimeMs: lap.lapTimeMs,
  };
}

/**
 * The union of channel ids that appear in AT LEAST one aligned series. The
 * caller uses this to build the channel-toggle list in the top bar. `speedMps`
 * is always first and always present (every session has speed).
 */
export function unionChannelIds(series: readonly AlignedSeries[]): string[] {
  const set = new Set<string>();
  set.add("speedMps");
  for (const s of series) {
    for (const k of Object.keys(s.channels)) set.add(k);
  }
  // Speed first, then the rest in a stable order.
  const rest = [...set].filter((k) => k !== "speedMps").sort();
  return ["speedMps", ...rest];
}
