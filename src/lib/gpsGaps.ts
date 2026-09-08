/**
 * GPS recording gaps — a stretch of a session where no fix was captured at
 * all, so nothing real is known about where the vehicle was or how it got
 * from one side of the gap to the other.
 *
 * The most common cause is a phone-GPS recording (`lib/gps/`) where the
 * browser tab lost the foreground for a while — mobile browsers stop
 * delivering `watchPosition` callbacks once a tab is backgrounded or the
 * screen sleeps, and a plain web page has no way to keep receiving location
 * updates through that (unlike a native app with a foreground service). The
 * map/chart used to draw a straight line and a linear-interpolated chart
 * segment across a gap like this, which reads as a real traveled path or a
 * real speed decay — it's neither. Detecting the gap lets the UI say so
 * instead of quietly fabricating a route.
 *
 * Any source can have a gap (a dropped BLE connection, a GNSS dropout in a
 * tunnel), so this isn't phone-GPS-specific — it just looks at the time
 * between consecutive samples.
 */
import type { GpsSample } from '@/types/racing';
import { haversineDistance } from './parserUtils';

export interface GpsGap {
  /** Index of the sample immediately before the gap. */
  beforeIndex: number;
  /** Index of the sample immediately after the gap. */
  afterIndex: number;
  /** Elapsed time between the two samples, ms. */
  durationMs: number;
  /** Great-circle distance between the two samples, meters. */
  distanceM: number;
}

/**
 * Below every real source's normal cadence by a wide margin — phone GPS is
 * ~1 Hz, RaceBox/Dragy/hardware loggers are all faster. A true gap this long
 * is never ordinary sampling jitter or a few missed fixes; it's a stretch
 * where nothing was captured at all.
 */
export const DEFAULT_GPS_GAP_THRESHOLD_MS = 15_000;

/**
 * Find every gap between consecutive samples wider than `thresholdMs`.
 * Samples are assumed to already be in time order (as `ParsedData.samples`
 * always is).
 */
export function detectGpsGaps(
  samples: readonly GpsSample[],
  thresholdMs: number = DEFAULT_GPS_GAP_THRESHOLD_MS,
): GpsGap[] {
  const gaps: GpsGap[] = [];
  for (let i = 1; i < samples.length; i++) {
    const durationMs = samples[i].t - samples[i - 1].t;
    if (durationMs < thresholdMs) continue;
    gaps.push({
      beforeIndex: i - 1,
      afterIndex: i,
      durationMs,
      distanceM: haversineDistance(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon),
    });
  }
  return gaps;
}

/** Total gap time across a session, ms — the headline number for a warning banner. */
export function totalGapMs(gaps: readonly GpsGap[]): number {
  return gaps.reduce((sum, g) => sum + g.durationMs, 0);
}

/** Short "1h 5m" / "5m 30s" / "45s" duration string for a gap-warning banner. */
export function formatGapDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
