import { describe, it, expect } from 'vitest';
import { RealtimeLapTimer, EMPTY_TIMING_STATE } from './realtimeTimer';
import type { GpsSample, Course } from '@/types/racing';

function makeSample(t: number, lat: number, lon: number, speedMps = 20): GpsSample {
  return { t, lat, lon, speedMps, speedMph: speedMps * 2.23694, speedKph: speedMps * 3.6, extraFields: {} };
}

/** S/F line: vertical at lon=0, lat ∈ [-0.0001, 0.0001] (mirrors lapCalculation tests). */
const sfCourse: Course = {
  name: 'TestCourse',
  startFinishA: { lat: 0.0001, lon: 0 },
  startFinishB: { lat: -0.0001, lon: 0 },
  isUserDefined: false,
};

/** N east-going S/F crossings → N-1 laps. */
function makeRacePath(numCrossings: number, intervalMs: number, speedMps = 20): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = 0;
  samples.push(makeSample(t, 0, -0.001, speedMps));
  for (let i = 0; i < numCrossings; i++) {
    t += intervalMs / 4;
    samples.push(makeSample(t, 0, 0.001, speedMps));
    if (i < numCrossings - 1) {
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, 0.001, speedMps));
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, -0.001, speedMps));
      t += intervalMs / 4;
      samples.push(makeSample(t, 0, -0.001, speedMps));
    }
  }
  return samples;
}

describe('RealtimeLapTimer — no course', () => {
  it('returns the empty state with live speed before a course is known', () => {
    const timer = new RealtimeLapTimer([]); // no tracks → never detects
    const state = timer.update(makeSample(0, 1, 1, 15));
    expect(state.courseName).toBeNull();
    expect(state.lapCount).toBe(0);
    expect(state.speedMph).toBeCloseTo(15 * 2.23694, 4);
  });

  it('exposes a stable EMPTY_TIMING_STATE shape', () => {
    expect(EMPTY_TIMING_STATE.lapCount).toBe(0);
    expect(EMPTY_TIMING_STATE.majorSectors).toEqual([]);
  });
});

describe('RealtimeLapTimer — locked course, incremental feed', () => {
  it('counts completed laps and tracks best/last as samples stream in', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse, 'Test Track');
    const path = makeRacePath(3, 60_000); // 3 crossings → 2 laps
    let state = timer.getState();
    for (const s of path) state = timer.update(s);

    expect(state.courseName).toBe('TestCourse');
    expect(state.trackName).toBe('Test Track');
    expect(state.lapCount).toBe(2);
    expect(state.bestLapMs).toBeGreaterThan(0);
    expect(state.bestLapMs).toBeCloseTo(60_000, -3); // ~60 s lap
    expect(state.lastLapMs).toBeCloseTo(60_000, -3);
    expect(state.bestLapNumber).not.toBeNull();
  });

  it('reports a non-negative in-progress current lap time', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse);
    let state = timer.getState();
    for (const s of makeRacePath(2, 40_000)) state = timer.update(s);
    expect(state.lapCount).toBe(1);
    expect(state.currentLapMs).not.toBeNull();
    expect(state.currentLapMs!).toBeGreaterThanOrEqual(0);
  });

  it('has no major-sector rollup for a start/finish-only course', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse);
    let state = timer.getState();
    for (const s of makeRacePath(3, 60_000)) state = timer.update(s);
    expect(state.majorSectors).toEqual([]);
  });

  it('keeps completed laps stable across further updates (idempotent recompute)', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse);
    for (const s of makeRacePath(3, 60_000)) timer.update(s);
    const before = timer.getState().lapCount;
    // extra stationary sample at the last position shouldn't drop laps
    timer.update(makeSample(200_000, 0, 0.001, 0));
    expect(timer.getState().lapCount).toBe(before);
  });
});
