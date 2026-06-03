/**
 * Chart X-axis abstraction shared by the analysis charts (TelemetryChart,
 * SingleSeriesChart).
 *
 * Charts historically plotted each sample at a linear index fraction
 * (`i / (n - 1)`) and labelled the axis as time. Serious telemetry tools plot
 * against **distance** so two laps line up corner-for-corner. This module turns
 * a sample array + a mode into:
 *  - `positions[i]` — the sample's fraction [0..1] along the chosen quantity
 *    (elapsed time or cumulative distance). The pixel axis is linear in that
 *    quantity, so data points sit at `fracAt(i) * chartWidth`.
 *  - `label(frac)` — the tick label for an axis fraction (mm:ss or a distance).
 *  - `indexAt(frac)` — inverse lookup for scrubbing (axis fraction → sample).
 *
 * Everything here is pure and React-free so it can be unit-tested directly.
 */

import { GpsSample } from '@/types/racing';
import { calculateDistanceArray } from './referenceUtils';

export type ChartXAxisMode = 'time' | 'distance';

const METERS_PER_FOOT = 0.3048;
const FEET_PER_MILE = 5280;

export interface ChartAxis {
  mode: ChartXAxisMode;
  /** Per-sample fraction [0..1] along the axis quantity (monotonic). */
  positions: number[];
  /** Total axis quantity — seconds (time) or meters (distance). */
  total: number;
  /** Fraction [0..1] for a sample index. */
  fracAt(i: number): number;
  /** Nearest sample index for an axis fraction [0..1]. */
  indexAt(frac: number): number;
  /** Tick label for an axis fraction [0..1]. */
  label(frac: number): string;
}

/** Format elapsed seconds as `m:ss`. */
export function formatAxisTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.abs(seconds % 60).toFixed(0).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Format a distance (in meters) using the unit family implied by the speed
 * unit: KPH → meters/km, MPH → feet/miles. Switches to the larger unit once
 * past a full km / mile so long sessions stay readable.
 */
export function formatAxisDistance(meters: number, useKph: boolean): string {
  if (useKph) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
  }
  const feet = meters / METERS_PER_FOOT;
  return feet >= FEET_PER_MILE ? `${(feet / FEET_PER_MILE).toFixed(2)} mi` : `${Math.round(feet)} ft`;
}

/**
 * Compute the per-sample axis fraction [0..1] for a mode. Falls back to a
 * linear index fraction whenever the chosen quantity has no span (single
 * sample, zero duration, or a stationary trace in distance mode) so the chart
 * always renders something sensible.
 */
export function computeAxisPositions(samples: GpsSample[], mode: ChartXAxisMode): number[] {
  const n = samples.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const indexFallback = () => samples.map((_, i) => i / (n - 1));

  if (mode === 'distance') {
    const dist = calculateDistanceArray(samples);
    const total = dist[dist.length - 1];
    if (!(total > 0)) return indexFallback();
    return dist.map((d) => d / total);
  }

  // time
  const t0 = samples[0].t;
  const total = samples[n - 1].t - t0;
  if (!(total > 0)) return indexFallback();
  return samples.map((s) => (s.t - t0) / total);
}

/** Nearest sample index whose position is closest to `frac` (positions monotonic). */
function nearestIndex(positions: number[], frac: number): number {
  const n = positions.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  const target = Math.max(0, Math.min(1, frac));

  // Binary search for the first index with position >= target.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] < target) lo = mid + 1;
    else hi = mid;
  }

  // Compare the bracketing candidate to its predecessor and pick the closer one.
  if (lo > 0 && Math.abs(positions[lo - 1] - target) <= Math.abs(positions[lo] - target)) {
    return lo - 1;
  }
  return lo;
}

/**
 * Build the axis helper for a sample set. `useKph` only affects distance-mode
 * tick labels (the unit family); positions are unit-agnostic fractions.
 */
export function buildChartAxis(
  samples: GpsSample[],
  mode: ChartXAxisMode,
  opts: { useKph: boolean },
): ChartAxis {
  const positions = computeAxisPositions(samples, mode);
  const n = samples.length;

  let total = 0;
  if (mode === 'distance') {
    const dist = calculateDistanceArray(samples);
    total = dist.length > 0 ? dist[dist.length - 1] : 0;
  } else if (n > 1) {
    total = (samples[n - 1].t - samples[0].t) / 1000; // seconds
  }

  return {
    mode,
    positions,
    total,
    fracAt: (i: number) => positions[i] ?? 0,
    indexAt: (frac: number) => nearestIndex(positions, frac),
    label: (frac: number) =>
      mode === 'distance'
        ? formatAxisDistance(total * frac, opts.useKph)
        : formatAxisTime(total * frac),
  };
}
