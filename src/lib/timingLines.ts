/**
 * Reconstructing timing-line geometry from a ride.
 *
 * A logger tells us a course exists but not what shape it is. RaceBox's GPX gives us bare Start /
 * Finish *points* (waypoints); its CSV gives us only the *moments* the device changed lap number.
 * Neither is a line. A timing line needs a position, an orientation and a length, and in both cases
 * the ride itself supplies the two we're missing: the rider's heading where they crossed is, by
 * definition, the direction that line is meant to be crossed in, so the line is laid perpendicular
 * to it, half its width to each side.
 *
 * Shared by gpxParser and raceboxCsvParser, which reconstruct the same geometry from different
 * evidence.
 */

import { GpsSample, SectorLine } from '@/types/racing';
import { EARTH_RADIUS_M, calculateBearing, haversineDistance } from './parserUtils';

/** Default total length of a reconstructed timing line, in metres. */
export const DEFAULT_TIMING_LINE_WIDTH_M = 50;

/**
 * Two timing lines closer together than this are the same line under two names — which is how a
 * lot of loop courses get exported ("Start" and "Finish" at the same place). Beyond it, the course
 * is genuinely point-to-point.
 */
export const COINCIDENT_LINE_M = 20;

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Build a timing line through `center`, perpendicular to the rider's heading at `nearIndex`.
 *
 * Heading is taken across a few samples rather than one, because at 25 Hz a single-sample heading
 * is mostly GPS noise. Returns null if the rider was stationary there — a standstill has no
 * heading, and a line laid on noise points anywhere.
 */
export function timingLineAt(
  center: LatLon,
  samples: GpsSample[],
  nearIndex: number,
  widthM: number = DEFAULT_TIMING_LINE_WIDTH_M,
): SectorLine | null {
  if (samples.length < 2 || nearIndex < 0 || nearIndex >= samples.length) return null;

  const a = samples[Math.max(0, nearIndex - 2)];
  const b = samples[Math.min(samples.length - 1, nearIndex + 2)];
  if (haversineDistance(a.lat, a.lon, b.lat, b.lon) < 0.5) return null;

  const heading = calculateBearing(a.lat, a.lon, b.lat, b.lon);

  // Endpoints lie perpendicular to the direction of travel: heading ± 90°.
  const half = widthM / 2;
  const project = (bearingDeg: number): LatLon => {
    const rad = (bearingDeg * Math.PI) / 180;
    const dNorth = Math.cos(rad) * half;
    const dEast = Math.sin(rad) * half;
    const latRad = (center.lat * Math.PI) / 180;
    return {
      lat: center.lat + (dNorth / EARTH_RADIUS_M) * (180 / Math.PI),
      lon: center.lon + (dEast / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI),
    };
  };

  return { a: project(heading - 90), b: project(heading + 90) };
}

/** Index of the sample that passed closest to `point`, or -1 when there are no samples. */
export function nearestSampleIndex(point: LatLon, samples: GpsSample[]): number {
  let nearest = -1;
  let nearestDist = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = haversineDistance(point.lat, point.lon, samples[i].lat, samples[i].lon);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * Build a timing line from a bare point (a GPX waypoint): the line runs through the point itself,
 * oriented by the rider's heading as they passed closest to it.
 */
export function timingLineAtPoint(
  point: LatLon,
  samples: GpsSample[],
  widthM: number = DEFAULT_TIMING_LINE_WIDTH_M,
): SectorLine | null {
  const nearest = nearestSampleIndex(point, samples);
  if (nearest === -1) return null;
  return timingLineAt(point, samples, nearest, widthM);
}

/**
 * Build a timing line from a *crossing event* between two consecutive samples (a device lap-number
 * change): the rider was on one side at `index - 1` and the other side at `index`, so the line lies
 * somewhere between them. We put it at the midpoint — the best estimate available, and biased by at
 * most half a sample interval (~20 ms at 25 Hz) either way.
 */
export function timingLineBetween(
  samples: GpsSample[],
  index: number,
  widthM: number = DEFAULT_TIMING_LINE_WIDTH_M,
): { line: SectorLine; at: LatLon } | null {
  if (index < 1 || index >= samples.length) return null;
  const at = midpoint(samples[index - 1], samples[index]);
  const line = timingLineAt(at, samples, index, widthM);
  return line ? { line, at } : null;
}

/** Midpoint of two fixes. Over a single sample interval, flat-earth averaging is exact enough. */
export function midpoint(a: LatLon, b: LatLon): LatLon {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}
