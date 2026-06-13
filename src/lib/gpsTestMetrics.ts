/**
 * Pure metrics for the GPS test / phone-as-datalogger demo (`pages/GpsTest`).
 *
 * The browser Geolocation API gives us a raw fix per callback but tells us
 * nothing about its own rate, and `coords.speed`/`coords.heading` are frequently
 * `null` on desktop and even on some phones. This module derives everything a
 * lap-timing library needs from the stream of fixes: sample rate (Hz), and a
 * "best available" speed/heading that falls back to point-to-point math when the
 * device omits them. Kept pure + framework-free so it's unit-testable and reusable
 * once the real datalogger feature lands.
 */
import { haversineDistance, calculateBearing } from '@/lib/parserUtils';

/** A single raw Geolocation fix, flattened from `GeolocationPosition`. */
export interface GeoFix {
  /** Epoch ms — `GeolocationPosition.timestamp`. */
  t: number;
  lat: number;
  lon: number;
  /** 68%-confidence radius in meters (`coords.accuracy`). */
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  /** Degrees [0,360), or null when the device doesn't report it. */
  heading: number | null;
  /** m/s, or null when the device doesn't report it. */
  speed: number | null;
}

/** Per-fix values derived from the previous fix (gap, rate, motion). */
export interface DerivedFix {
  /** Seconds since the previous fix, or null for the first fix. */
  dtSec: number | null;
  /** Instantaneous rate (1/dtSec) in Hz, or null for the first fix. */
  instantHz: number | null;
  /** Great-circle meters traveled since the previous fix. */
  distanceM: number | null;
  /** distanceM / dtSec in m/s — our own speed estimate. */
  derivedSpeedMps: number | null;
  /** Bearing from the previous fix, degrees [0,360). */
  derivedHeading: number | null;
}

const MPS_TO_MPH = 2.236936;
const MPS_TO_KPH = 3.6;

/** Compute the previous-relative metrics for one fix. */
export function deriveFix(prev: GeoFix | null, cur: GeoFix): DerivedFix {
  if (!prev) {
    return { dtSec: null, instantHz: null, distanceM: null, derivedSpeedMps: null, derivedHeading: null };
  }
  const dtSec = (cur.t - prev.t) / 1000;
  const distanceM = haversineDistance(prev.lat, prev.lon, cur.lat, cur.lon);
  // A duplicate/zero-gap callback (some browsers fire two for one fix) can't
  // produce a rate or speed — guard the divide so we don't emit Infinity.
  const moving = dtSec > 0;
  return {
    dtSec,
    instantHz: moving ? 1 / dtSec : null,
    distanceM,
    derivedSpeedMps: moving ? distanceM / dtSec : null,
    derivedHeading: distanceM > 0 ? calculateBearing(prev.lat, prev.lon, cur.lat, cur.lon) : null,
  };
}

/**
 * Average rate (Hz) over the most recent `window` fixes, derived from the spread
 * of their timestamps (not a mean of per-gap rates, which over-weights short
 * gaps). Returns null until at least two fixes exist.
 */
export function averageHz(fixes: Pick<GeoFix, 't'>[], window = 20): number | null {
  if (fixes.length < 2) return null;
  const recent = fixes.slice(-window);
  const span = (recent[recent.length - 1].t - recent[0].t) / 1000;
  if (span <= 0) return null;
  return (recent.length - 1) / span;
}

/** Speed in m/s preferring the device value, falling back to our derived one. */
export function bestSpeedMps(fix: GeoFix, derived: DerivedFix): number | null {
  if (fix.speed != null && fix.speed >= 0) return fix.speed;
  return derived.derivedSpeedMps;
}

/** Heading in degrees preferring the device value, falling back to derived. */
export function bestHeading(fix: GeoFix, derived: DerivedFix): number | null {
  if (fix.heading != null && !Number.isNaN(fix.heading)) return fix.heading;
  return derived.derivedHeading;
}

/**
 * Shape a fix into the record a lap-timing library consumes: time-since-start in
 * ms plus lat/lon and best-available speed (in all three units) + heading. This
 * mirrors the core `GpsSample` so captured demo data can be fed straight in.
 */
export interface TimingSample {
  t: number; // ms since session start
  lat: number;
  lon: number;
  speedMps: number;
  speedMph: number;
  speedKph: number;
  heading: number | null;
  accuracy: number;
}

export function toTimingSample(fix: GeoFix, derived: DerivedFix, startT: number): TimingSample {
  const mps = bestSpeedMps(fix, derived) ?? 0;
  return {
    t: fix.t - startT,
    lat: fix.lat,
    lon: fix.lon,
    speedMps: mps,
    speedMph: mps * MPS_TO_MPH,
    speedKph: mps * MPS_TO_KPH,
    heading: bestHeading(fix, derived),
    accuracy: fix.accuracy,
  };
}
