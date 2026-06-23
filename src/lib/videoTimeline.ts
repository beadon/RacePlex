/**
 * Pure session-time ↔ video-time model.
 *
 * A synced video is anchored to ABSOLUTE session time by a single
 * `syncOffsetMs`: the session time (ms from session start) that lines up with
 * video virtual time 0. Because `GpsSample.t` is absolute session time, this
 * anchor is fixed for the whole session — switching laps or cropping the range
 * never moves it, so a video is synced once and never needs re-syncing.
 *
 *   telemetry(sessionMs) = videoVirtualSec * 1000 + syncOffsetMs
 *   videoVirtualSec      = (sessionMs - syncOffsetMs) / 1000
 *
 * `syncOffsetMs > 0` means the camera started AFTER the datalogger (the common
 * case — the video covers only a later slice of the session); `< 0` means it
 * started before. The footage therefore covers a finite window of the session
 * timeline, and session times outside it have no video ("partial video").
 */

/** Where a session time falls relative to the video's coverage window. */
export type VideoCoverage = 'before' | 'covered' | 'after';

/** Absolute session time (ms) → video virtual time (seconds). */
export function sessionMsToVideoSec(sessionMs: number, syncOffsetMs: number): number {
  return (sessionMs - syncOffsetMs) / 1000;
}

/** Video virtual time (seconds) → absolute session time (ms). */
export function videoSecToSessionMs(videoSec: number, syncOffsetMs: number): number {
  return videoSec * 1000 + syncOffsetMs;
}

/** The session-time window [startMs, endMs] the footage covers. */
export function videoCoverageMs(
  syncOffsetMs: number,
  durationSec: number,
): { startMs: number; endMs: number } {
  return { startMs: syncOffsetMs, endMs: syncOffsetMs + durationSec * 1000 };
}

/**
 * Whether a session time has video, and if not which side it falls off:
 * `before` = footage hasn't started yet, `after` = footage already ended.
 */
export function coverageOf(
  sessionMs: number,
  syncOffsetMs: number,
  durationSec: number,
): VideoCoverage {
  const videoSec = sessionMsToVideoSec(sessionMs, syncOffsetMs);
  if (videoSec < 0) return 'before';
  if (videoSec > durationSec) return 'after';
  return 'covered';
}

/** How much of a lap (by its absolute start/end ms) the footage covers. */
export function lapCoverage(
  lapStartMs: number,
  lapEndMs: number,
  syncOffsetMs: number,
  durationSec: number,
): 'full' | 'partial' | 'none' {
  const { startMs, endMs } = videoCoverageMs(syncOffsetMs, durationSec);
  if (lapEndMs < startMs || lapStartMs > endMs) return 'none';
  if (lapStartMs >= startMs && lapEndMs <= endMs) return 'full';
  return 'partial';
}
