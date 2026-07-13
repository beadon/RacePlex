/**
 * Straight-line (drag) run analysis — issue #43.
 *
 * A drag result is two questions asked of the same trace:
 *
 *   - how long to get from one SPEED to another (0-60, 60-130, 0-130)
 *   - how long to cover a DISTANCE, and how fast were you at the end of it
 *     (1/8, 1/4, 1/2 mile elapsed time + trap speed)
 *
 * Both are threshold crossings, and both are **interpolated between samples**,
 * exactly as `lapCalculation` interpolates a timing-line crossing. Snapping to
 * the nearest fix would quantise every result to the logger's sample interval:
 * at 25 Hz that is 40 ms, which is the same size as the differences riders are
 * trying to measure.
 *
 * ## These speeds are real on a PEV
 *
 * The 130 mph brackets are not decoration inherited from car tooling. High-end
 * electric unicycles reach the high 80s, so the upper brackets have to actually
 * work rather than be clamped away.
 *
 * ## A drag result from a slow logger is a fiction
 *
 * At 60 mph a 1 Hz fix lands every 27 metres. A quarter-mile ET derived from
 * that is an estimate with an error far larger than the differences anyone
 * cares about. `rateWarning()` grades the session's MEASURED rate so the UI can
 * say so on the result itself — see issue #43. It is not optional chrome.
 */

import { haversineDistance } from "./parserUtils";
import type { GpsSample } from "@/types/racing";

/** Standard drag distances, in metres. */
export const EIGHTH_MILE_M = 201.168;
export const QUARTER_MILE_M = 402.336;
export const HALF_MILE_M = 804.672;

/**
 * The speed at which the clock starts, mph.
 *
 * A "0-60" cannot literally start at zero. GPS speed has a noise floor — a
 * stationary board reads a few tenths of a mph — so the instant of true zero is
 * not observable, and every consumer meter defines launch as a small threshold
 * crossing instead. We do the same, and we say so.
 *
 * Consequence, stated plainly: the run is timed from 0.5 mph rather than from
 * rest, which flatters the result by however long the board takes to reach
 * 0.5 mph — about 0.06 s at a brisk 4 m/s². It is a bias, it is small, and it is
 * in the optimistic direction. Do not compare our numbers against a drag strip's
 * beams and expect them to agree to the hundredth.
 */
export const LAUNCH_SPEED_MPH = 0.5;

export interface SpeedBracket {
  fromMph: number;
  toMph: number;
}

/** The brackets a drag tool is expected to report. */
export const DEFAULT_SPEED_BRACKETS: SpeedBracket[] = [
  { fromMph: 0, toMph: 30 },
  { fromMph: 0, toMph: 60 },
  { fromMph: 60, toMph: 130 },
  { fromMph: 0, toMph: 130 },
];

export interface SpeedRun extends SpeedBracket {
  /** Time between the two interpolated speed crossings, ms. Null = never reached. */
  timeMs: number | null;
}

export interface DistanceRun {
  distanceM: number;
  /** Elapsed time from launch to the interpolated distance crossing, ms. */
  timeMs: number | null;
  /** Speed at the moment that distance was crossed, mph — the "trap speed". */
  trapSpeedMph: number | null;
}

export type RateGrade = "good" | "marginal" | "poor";

export interface RateWarning {
  hz: number;
  grade: RateGrade;
  /** Metres between fixes at 60 mph — the number that makes the point concrete. */
  metresPerFixAt60Mph: number;
}

export interface DragResult {
  /** Sample index just before the launch instant. */
  launchIndex: number;
  /** Interpolated instant the run starts, ms — NOT samples[launchIndex].t. */
  launchTimeMs: number;
  speedRuns: SpeedRun[];
  distanceRuns: DistanceRun[];
  rate: RateWarning;
  /** Highest speed reached during the run, mph. */
  topSpeedMph: number;
}

/**
 * Linear interpolation factor for `target` between `a` and `b`.
 * Returns null when the pair doesn't straddle the target.
 */
function crossFraction(a: number, b: number, target: number): number | null {
  if (a === b) return null;
  const f = (target - a) / (b - a);
  return f >= 0 && f <= 1 ? f : null;
}

/**
 * Time at which speed first rises through `targetMph`, searching from `fromIndex`.
 *
 * Rising crossings only: a run that dips back under 60 and climbs again should
 * report the first time it got there, not the last.
 */
function timeAtSpeed(
  samples: GpsSample[],
  targetMph: number,
  fromIndex: number,
): number | null {
  // Already at or above it at the start (0-x brackets from a standing start).
  if (samples[fromIndex] && samples[fromIndex].speedMph >= targetMph) {
    return samples[fromIndex].t;
  }
  for (let i = fromIndex; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.speedMph < targetMph && b.speedMph >= targetMph) {
      const f = crossFraction(a.speedMph, b.speedMph, targetMph);
      if (f === null) continue;
      return a.t + f * (b.t - a.t);
    }
  }
  return null;
}

/**
 * Cumulative ground distance from `launchIndex`, metres, one entry per sample.
 *
 * Ground distance rather than the speed integral: a GPS trace's positions are
 * what the device is most confident about, and integrating a noisy speed channel
 * accumulates its bias over the whole run.
 */
export function cumulativeDistanceM(samples: GpsSample[], launchIndex: number): number[] {
  const out = new Array<number>(samples.length).fill(0);
  let acc = 0;
  for (let i = launchIndex + 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    acc += haversineDistance(a.lat, a.lon, b.lat, b.lon);
    out[i] = acc;
  }
  return out;
}

/**
 * The sample the run launches from: the last one still stationary before the
 * board gets going and stays going.
 *
 * Falls back to index 0 for a trace that is already moving (a rolling start, or
 * a log that begins mid-run) — the speed brackets still work, the distances are
 * just measured from wherever the log begins.
 */
export function findLaunchIndex(samples: GpsSample[]): number {
  for (let i = 0; i < samples.length - 1; i++) {
    if (samples[i].speedMph <= LAUNCH_SPEED_MPH && samples[i + 1].speedMph > LAUNCH_SPEED_MPH) {
      return i;
    }
  }
  return 0;
}

/**
 * Grade the session's measured sample rate for drag use.
 *
 * The thresholds: 10 Hz puts a fix every 2.7 m at 60 mph, which is enough to
 * interpolate a quarter-mile crossing to within a few hundredths. 1 Hz puts one
 * every 27 m, which is not. Marginal in between, because a 5 Hz log is usable
 * for a 0-30 and misleading for a trap speed.
 */
export function rateWarning(samples: GpsSample[]): RateWarning {
  const n = samples.length;
  const durationMs = n > 1 ? samples[n - 1].t - samples[0].t : 0;
  const hz = durationMs > 0 && n > 1 ? ((n - 1) / durationMs) * 1000 : 0;

  const MPS_AT_60MPH = 26.8224;
  const metresPerFixAt60Mph = hz > 0 ? MPS_AT_60MPH / hz : Infinity;

  const grade: RateGrade = hz >= 10 ? "good" : hz >= 5 ? "marginal" : "poor";
  return { hz, grade, metresPerFixAt60Mph };
}

/**
 * Analyse a straight-line run.
 *
 * `samples` should already be cropped to the run (the UI hands in the selected
 * range). Everything is measured from the launch sample, so a trace with a long
 * idle before the run still reports honest times.
 */
export function analyzeDragRun(
  samples: GpsSample[],
  brackets: SpeedBracket[] = DEFAULT_SPEED_BRACKETS,
): DragResult | null {
  if (samples.length < 2) return null;

  const launchIndex = findLaunchIndex(samples);
  // Interpolated, not snapped. The last sample under the threshold sits AFTER
  // motion began, and timing from it makes every run read fast.
  const launchT = timeAtSpeed(samples, LAUNCH_SPEED_MPH, launchIndex) ?? samples[launchIndex].t;

  const speedRuns: SpeedRun[] = brackets.map(({ fromMph, toMph }) => {
    // A 0-x bracket runs from the launch instant, not from the first sample that
    // happens to read 0 — a trace can sit still for a minute first.
    const startT = fromMph <= LAUNCH_SPEED_MPH ? launchT : timeAtSpeed(samples, fromMph, launchIndex);
    if (startT === null) return { fromMph, toMph, timeMs: null };

    // Search for the upper crossing from the launch, not from the lower one's
    // index — timeAtSpeed works in time, and the lower crossing is a time, not
    // an index. Rising-only means we still get the first arrival at `toMph`.
    const endT = timeAtSpeed(samples, toMph, launchIndex);
    if (endT === null || endT < startT) return { fromMph, toMph, timeMs: null };

    return { fromMph, toMph, timeMs: endT - startT };
  });

  const dist = cumulativeDistanceM(samples, launchIndex);
  const distanceRuns: DistanceRun[] = [EIGHTH_MILE_M, QUARTER_MILE_M, HALF_MILE_M].map(
    (distanceM) => {
      for (let i = launchIndex; i < samples.length - 1; i++) {
        const f = crossFraction(dist[i], dist[i + 1], distanceM);
        if (f === null) continue;
        const a = samples[i];
        const b = samples[i + 1];
        return {
          distanceM,
          timeMs: a.t + f * (b.t - a.t) - launchT,
          trapSpeedMph: a.speedMph + f * (b.speedMph - a.speedMph),
        };
      }
      return { distanceM, timeMs: null, trapSpeedMph: null };
    },
  );

  let topSpeedMph = 0;
  for (let i = launchIndex; i < samples.length; i++) {
    if (samples[i].speedMph > topSpeedMph) topSpeedMph = samples[i].speedMph;
  }

  return {
    launchIndex,
    launchTimeMs: launchT,
    speedRuns,
    distanceRuns,
    rate: rateWarning(samples),
    topSpeedMph,
  };
}
