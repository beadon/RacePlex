/**
 * Pure data prep for the G-G diagram (friction circle): a lateral-vs-
 * longitudinal G scatter that shows how much of the tyre's grip envelope a
 * driver is using. View code (GGDiagram.tsx) handles the canvas; everything
 * here is pure and unit-tested.
 *
 * Axis convention (screen mapping lives in the view): X = lateral g, Y =
 * longitudinal g with **positive = acceleration**. The data is unsigned here —
 * the view decides which way is up.
 */

import { GpsSample } from '@/types/racing';
import { applySmoothingToValues } from './chartUtils';
import type { GForceSource } from './chartUtils';

export interface GForcePair {
  /** Lateral-g channel id (X axis). */
  x: string;
  /** Longitudinal-g channel id (Y axis). */
  y: string;
  /** Short human label for the source (e.g. "GPS", "Native"). */
  source: string;
}

/** A single plotted point, or null where the sample lacks usable g data. */
export type GGPoint = { x: number; y: number } | null;

// Candidate lateral/longitudinal pairs, best-first. The raw IMU accel_x/y/z are
// deliberately excluded — they're body-frame and not guaranteed grip-aligned.
const GPS_PAIR: GForcePair = { x: 'lat_g', y: 'lon_g', source: 'GPS' };
const NATIVE_PAIR: GForcePair = { x: 'lat_g_native', y: 'lon_g_native', source: 'Native' };

function pairHasData(samples: GpsSample[], pair: GForcePair): boolean {
  return samples.some(
    (s) => s.extraFields[pair.x] !== undefined || s.extraFields[pair.y] !== undefined,
  );
}

/**
 * Pick the lateral/longitudinal g pair to plot. Honors the user's G-force
 * source preference (HW prefers the logger-native pair), falling back to
 * whichever pair actually carries data. Returns null when neither is present.
 */
export function pickGForcePair(samples: GpsSample[], source: GForceSource): GForcePair | null {
  const order = source === 'hw' ? [NATIVE_PAIR, GPS_PAIR] : [GPS_PAIR, NATIVE_PAIR];
  for (const pair of order) {
    if (pairHasData(samples, pair)) return pair;
  }
  return null;
}

/**
 * Build per-sample G-G points (aligned to `samples`, null where a sample lacks
 * either component), with optional moving-average smoothing applied per axis to
 * tame GPS jitter. `smoothingWindow <= 1` disables smoothing.
 */
export function computeGGPoints(
  samples: GpsSample[],
  pair: GForcePair,
  smoothingWindow = 1,
): GGPoint[] {
  if (samples.length === 0) return [];

  const rawX = samples.map((s) => s.extraFields[pair.x]);
  const rawY = samples.map((s) => s.extraFields[pair.y]);
  const xs = smoothingWindow > 1 ? applySmoothingToValues(rawX, smoothingWindow) : rawX;
  const ys = smoothingWindow > 1 ? applySmoothingToValues(rawY, smoothingWindow) : rawY;

  return samples.map((_, i) => {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) return null;
    return { x, y };
  });
}

/**
 * Symmetric axis extent (in g) covering every supplied point set, rounded up to
 * a clean 0.5 g ring and clamped to a sane [1.5, 3.0] g window so the circle
 * never collapses or runs off scale.
 */
export function computeGGAxisMax(...pointSets: GGPoint[][]): number {
  let peak = 0;
  for (const points of pointSets) {
    for (const p of points) {
      if (!p) continue;
      peak = Math.max(peak, Math.abs(p.x), Math.abs(p.y));
    }
  }
  const padded = peak * 1.05;
  const rounded = Math.ceil(padded / 0.5) * 0.5;
  return Math.min(3.0, Math.max(1.5, rounded));
}
