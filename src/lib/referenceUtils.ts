/**
 * Utilities for reference lap comparison:
 * - Distance-based interpolation
 * - Pace calculation (time delta at equal distance)
 * - Reference speed alignment
 */

import { GpsSample } from '@/types/racing';
import { EARTH_RADIUS_M } from './parserUtils';

interface Point {
  x: number;
  y: number;
}

// Project lat/lon to local planar coordinates (equirectangular approximation)
export function projectToPlane(lat: number, lon: number, centerLat: number, centerLon: number): Point {
  const x = (lon - centerLon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(centerLat * Math.PI / 180);
  const y = (lat - centerLat) * Math.PI / 180 * EARTH_RADIUS_M;
  return { x, y };
}

// Calculate distance between two planar points
function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Calculate cumulative distance array for samples
export function calculateDistanceArray(samples: GpsSample[]): number[] {
  if (samples.length === 0) return [];
  
  // Find center for projection
  const centerLat = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
  const centerLon = samples.reduce((sum, s) => sum + s.lon, 0) / samples.length;
  
  const distances: number[] = [0];
  
  for (let i = 1; i < samples.length; i++) {
    const p1 = projectToPlane(samples[i - 1].lat, samples[i - 1].lon, centerLat, centerLon);
    const p2 = projectToPlane(samples[i].lat, samples[i].lon, centerLat, centerLon);
    distances.push(distances[i - 1] + distance(p1, p2));
  }
  
  return distances;
}

// Interpolate a value from reference samples at a given distance
function interpolateAtDistance(
  targetDistance: number,
  refDistances: number[],
  refSamples: GpsSample[],
  getValue: (sample: GpsSample) => number
): number | null {
  if (refDistances.length === 0 || refSamples.length === 0) return null;
  
  const totalRefDistance = refDistances[refDistances.length - 1];
  
  // Clamp to available range
  if (targetDistance < 0) targetDistance = 0;
  if (targetDistance > totalRefDistance) return null; // Beyond reference lap
  
  // Binary search for bracketing indices
  let lo = 0;
  let hi = refDistances.length - 1;
  
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (refDistances[mid] <= targetDistance) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  
  // Interpolate between lo and hi
  const d1 = refDistances[lo];
  const d2 = refDistances[hi];
  
  if (d2 === d1) return getValue(refSamples[lo]);
  
  const t = (targetDistance - d1) / (d2 - d1);
  const v1 = getValue(refSamples[lo]);
  const v2 = getValue(refSamples[hi]);
  
  return v1 + t * (v2 - v1);
}

/**
 * Calculate pace (time delta vs reference) for each sample in current lap.
 * Positive = slower (behind), Negative = faster (ahead)
 */
export function calculatePace(
  currentSamples: GpsSample[],
  refSamples: GpsSample[]
): (number | null)[] {
  if (currentSamples.length === 0 || refSamples.length === 0) return [];
  
  const currentDistances = calculateDistanceArray(currentSamples);
  const refDistances = calculateDistanceArray(refSamples);
  
  // Current lap start time (normalized to 0)
  const currentStartTime = currentSamples[0].t;
  // Reference lap start time (normalized to 0)
  const refStartTime = refSamples[0].t;
  
  const pace: (number | null)[] = [];
  
  for (let i = 0; i < currentSamples.length; i++) {
    const currentTime = (currentSamples[i].t - currentStartTime) / 1000; // seconds from lap start
    const currentDistance = currentDistances[i];
    
    // Find reference time at same distance
    const refTimeAtDistance = interpolateAtDistance(
      currentDistance,
      refDistances,
      refSamples,
      (s) => (s.t - refStartTime) / 1000 // seconds from ref lap start
    );
    
    if (refTimeAtDistance === null) {
      pace.push(null);
    } else {
      // Pace = current time - reference time at same distance
      // Positive = slower (behind), Negative = faster (ahead)
      pace.push(currentTime - refTimeAtDistance);
    }
  }
  
  return pace;
}

/**
 * Calculate reference speed aligned to current lap's distance progression.
 * Returns speed values (mph or kph based on useKph) for each current sample.
 */
export function calculateReferenceSpeed(
  currentSamples: GpsSample[],
  refSamples: GpsSample[],
  useKph: boolean
): (number | null)[] {
  if (currentSamples.length === 0 || refSamples.length === 0) return [];
  
  const currentDistances = calculateDistanceArray(currentSamples);
  const refDistances = calculateDistanceArray(refSamples);
  
  const refSpeeds: (number | null)[] = [];
  
  for (let i = 0; i < currentSamples.length; i++) {
    const currentDistance = currentDistances[i];
    
    const refSpeed = interpolateAtDistance(
      currentDistance,
      refDistances,
      refSamples,
      (s) => useKph ? s.speedKph : s.speedMph
    );
    
    refSpeeds.push(refSpeed);
  }
  
  return refSpeeds;
}

/**
 * Align another lap's per-sample value onto the current lap's distance axis:
 * for each current sample, interpolate the other lap's value at the same
 * cumulative distance. One entry per current sample — `null` beyond the other
 * lap's length, or where the source value is missing. Generalizes
 * `calculateReferenceSpeed` to any channel (used for multi-lap chart overlays).
 */
export function alignByDistance(
  currentSamples: GpsSample[],
  otherSamples: GpsSample[],
  getValue: (s: GpsSample) => number | undefined,
): (number | null)[] {
  return alignValuesByDistance(currentSamples, otherSamples, otherSamples.map(getValue));
}

/**
 * Like `alignByDistance`, but for a *derived* series that isn't stored on the
 * sample: the values to align live in a parallel array indexed 1:1 to
 * `otherSamples` (e.g. a computed brake-% series). For each current sample,
 * interpolate the other lap's value at the same cumulative distance — `null`
 * beyond the other lap's length or where the source value is missing.
 */
export function alignValuesByDistance(
  currentSamples: GpsSample[],
  otherSamples: GpsSample[],
  values: (number | null | undefined)[],
): (number | null)[] {
  if (currentSamples.length === 0 || otherSamples.length === 0) return [];

  const curD = calculateDistanceArray(currentSamples);
  const refD = calculateDistanceArray(otherSamples);
  const maxRef = refD[refD.length - 1];
  const out: (number | null)[] = [];

  for (let i = 0; i < currentSamples.length; i++) {
    const target = curD[i];
    if (target > maxRef) { out.push(null); continue; }

    let lo = 0;
    let hi = refD.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (refD[mid] <= target) lo = mid; else hi = mid;
    }

    const v1 = values[lo];
    if (v1 === undefined || v1 === null) { out.push(null); continue; }
    const v2 = values[hi];
    const d1 = refD[lo];
    const d2 = refD[hi];
    if (d2 === d1 || v2 === undefined || v2 === null) { out.push(v1); continue; }
    out.push(v1 + ((target - d1) / (d2 - d1)) * (v2 - v1));
  }

  return out;
}

/**
 * Map a sample index from one lap onto another by matching cumulative track
 * distance. Given the index of a point on `fromDistances`, returns the index of
 * the nearest point on `toDistances` at the same distance along the lap. Used to
 * keep a single playback cursor pointing at the same track position across two
 * laps of different length/duration (split-graphs side-by-side comparison).
 *
 * Both inputs are cumulative-distance arrays (see `calculateDistanceArray`), so
 * the per-tick cost is just a binary search — callers memoize the arrays.
 */
export function mapIndexByDistance(
  fromDistances: number[],
  toDistances: number[],
  idx: number,
): number {
  if (fromDistances.length === 0 || toDistances.length === 0) return 0;
  const i = Math.max(0, Math.min(idx, fromDistances.length - 1));
  const target = fromDistances[i];
  const maxTo = toDistances[toDistances.length - 1];
  if (target <= 0) return 0;
  if (target >= maxTo) return toDistances.length - 1;

  let lo = 0;
  let hi = toDistances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (toDistances[mid] <= target) lo = mid; else hi = mid;
  }
  // Snap to whichever bracketing sample is closer in distance.
  return target - toDistances[lo] <= toDistances[hi] - target ? lo : hi;
}

/**
 * Precompute reference data for a lap.
 */
export interface ReferenceData {
  samples: GpsSample[];
  distances: number[];
  totalDistance: number;
}

export function computeReferenceData(samples: GpsSample[]): ReferenceData {
  const distances = calculateDistanceArray(samples);
  return {
    samples,
    distances,
    totalDistance: distances.length > 0 ? distances[distances.length - 1] : 0
  };
}
