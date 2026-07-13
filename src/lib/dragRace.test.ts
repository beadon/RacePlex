/**
 * Drag-run analysis (#43).
 *
 * The anchor test is a synthetic constant-acceleration run, because that has a
 * closed-form answer: v = a·t and s = ½·a·t². So the expected 0-60 time and the
 * quarter-mile ET are things we can DERIVE, not numbers copied out of the
 * implementation. If the code and the test both drift, the physics won't.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeDragRun,
  findLaunchIndex,
  rateWarning,
  cumulativeDistanceM,
  QUARTER_MILE_M,
  EIGHTH_MILE_M,
  LAUNCH_SPEED_MPH,
} from "./dragRace";
import type { GpsSample } from "@/types/racing";

const MPH_PER_MPS = 2.2369362920544;

/**
 * The clock starts at LAUNCH_SPEED_MPH, not at a true zero the GPS cannot see
 * (see dragRace.ts). So under constant acceleration the launch instant is
 * t = v_launch / a, and every 0-x bracket is measured from there. The tests
 * derive that rather than hardcoding it, so the constant and the maths can't
 * drift apart.
 */
const launchTimeS = (a: number) => LAUNCH_SPEED_MPH / MPH_PER_MPS / a;
const zeroToS = (a: number, targetMph: number) => targetMph / MPH_PER_MPS / a - launchTimeS(a);
const M_PER_DEG_LAT = 111_194.9; // at the equator, close enough for a straight run north

/**
 * A run at constant acceleration `aMps2`, sampled at `hz`, heading due north
 * from (0,0). Position is derived from the analytic s(t), so ground distance and
 * speed agree with each other exactly — any error the test catches is the
 * analyser's, not the fixture's.
 */
function constantAccelRun(aMps2: number, seconds: number, hz: number, idleMs = 0): GpsSample[] {
  const out: GpsSample[] = [];
  const dtMs = 1000 / hz;

  // Sit still first, so the launch detector has something to find.
  for (let t = 0; t < idleMs; t += dtMs) {
    out.push({ t, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0, extraFields: {} });
  }

  for (let ms = 0; ms <= seconds * 1000; ms += dtMs) {
    const s = ms / 1000;
    const v = aMps2 * s; // m/s
    const d = 0.5 * aMps2 * s * s; // metres travelled
    out.push({
      t: idleMs + ms,
      lat: d / M_PER_DEG_LAT,
      lon: 0,
      speedMps: v,
      speedMph: v * MPH_PER_MPS,
      speedKph: v * 3.6,
      extraFields: {},
    });
  }
  return out;
}

describe("findLaunchIndex", () => {
  it("finds the last sample below the launch threshold", () => {
    const s = constantAccelRun(4, 5, 25, 2000);
    const i = findLaunchIndex(s);
    expect(s[i].speedMph).toBeLessThanOrEqual(LAUNCH_SPEED_MPH);
    expect(s[i + 1].speedMph).toBeGreaterThan(LAUNCH_SPEED_MPH);
  });

  it("falls back to 0 for a rolling start (log begins mid-run)", () => {
    const s = constantAccelRun(4, 5, 25).slice(20); // already moving at sample 0
    expect(findLaunchIndex(s)).toBe(0);
  });
});

describe("analyzeDragRun — against the closed form", () => {
  // a = 4 m/s². v = a·t, so 60 mph (26.8224 m/s) arrives at t = 26.8224/4 = 6.7056 s.
  const A = 4;
  const samples = constantAccelRun(A, 20, 25, 2000);
  const result = analyzeDragRun(samples)!;

  it("0-60 matches v = a·t, timed from the launch threshold", () => {
    const run = result.speedRuns.find((r) => r.fromMph === 0 && r.toMph === 60)!;
    expect(run.timeMs! / 1000).toBeCloseTo(zeroToS(A, 60), 2);
  });

  it("0-30 matches v = a·t", () => {
    const run = result.speedRuns.find((r) => r.fromMph === 0 && r.toMph === 30)!;
    expect(run.timeMs! / 1000).toBeCloseTo(zeroToS(A, 30), 2);
  });

  it("the launch instant is interpolated, not snapped to a sample", () => {
    // Snapping to samples[launchIndex].t would land AFTER motion began and make
    // every run read fast. This is the bug the closed-form test caught.
    expect(result.launchTimeMs).not.toBe(samples[result.launchIndex].t);
    expect(result.launchTimeMs).toBeGreaterThan(samples[result.launchIndex].t);
    expect(result.launchTimeMs).toBeLessThan(samples[result.launchIndex + 1].t);
  });

  it("60-130 is the difference of the two crossings", () => {
    const t60 = 26.8224 / A;
    const t130 = 130 / MPH_PER_MPS / A;
    const run = result.speedRuns.find((r) => r.fromMph === 60 && r.toMph === 130)!;
    expect(run.timeMs! / 1000).toBeCloseTo(t130 - t60, 2);
  });

  it("quarter-mile ET matches s = ½·a·t²", () => {
    // 402.336 = ½·4·t² → t = 14.183 s from rest, less the launch offset.
    const expectedS = Math.sqrt((2 * QUARTER_MILE_M) / A) - launchTimeS(A);
    const q = result.distanceRuns.find((d) => d.distanceM === QUARTER_MILE_M)!;
    expect(q.timeMs! / 1000).toBeCloseTo(expectedS, 1);
  });

  it("trap speed at the quarter is v = a·t at that instant", () => {
    const tQuarter = Math.sqrt((2 * QUARTER_MILE_M) / A);
    const expectedMph = A * tQuarter * MPH_PER_MPS;
    const q = result.distanceRuns.find((d) => d.distanceM === QUARTER_MILE_M)!;
    expect(q.trapSpeedMph!).toBeCloseTo(expectedMph, 0);
  });

  it("the eighth comes before the quarter, and slower", () => {
    const e = result.distanceRuns.find((d) => d.distanceM === EIGHTH_MILE_M)!;
    const q = result.distanceRuns.find((d) => d.distanceM === QUARTER_MILE_M)!;
    expect(e.timeMs!).toBeLessThan(q.timeMs!);
    expect(e.trapSpeedMph!).toBeLessThan(q.trapSpeedMph!);
  });

  it("times from the launch, not from the first sample — the idle doesn't count", () => {
    // 2 s of standing still precede the run. A 0-60 of 8.7 s would mean we
    // started the clock at the top of the file.
    const run = result.speedRuns.find((r) => r.toMph === 60)!;
    expect(run.timeMs! / 1000).toBeLessThan(7);
  });
});

describe("analyzeDragRun — the interpolation is the point", () => {
  it("beats the sample grid: 0-60 is not quantised to the 1 Hz interval", () => {
    // At 1 Hz the samples straddle 60 mph; the true crossing is between them.
    // Snapping to the nearest fix would return a whole number of seconds.
    const s = constantAccelRun(4, 20, 1);
    const run = analyzeDragRun(s)!.speedRuns.find((r) => r.toMph === 60)!;
    const t = run.timeMs! / 1000;
    expect(t).toBeCloseTo(zeroToS(4, 60), 2);
    expect(Number.isInteger(t)).toBe(false); // it interpolated
  });

  it("a 25 Hz and a 1 Hz log of the same run agree to a few hundredths", () => {
    const fast = analyzeDragRun(constantAccelRun(4, 20, 25))!;
    const slow = analyzeDragRun(constantAccelRun(4, 20, 1))!;
    const f = fast.speedRuns.find((r) => r.toMph === 60)!.timeMs!;
    const sl = slow.speedRuns.find((r) => r.toMph === 60)!.timeMs!;
    // Interpolation on a clean signal recovers it. Real GPS noise is what makes
    // the slow log untrustworthy — hence the warning, not a refusal to compute.
    expect(Math.abs(f - sl)).toBeLessThan(50);
  });
});

describe("analyzeDragRun — brackets that were never reached", () => {
  it("reports null rather than a number, for a run that never hits 130", () => {
    const s = constantAccelRun(4, 8, 25); // tops out around 70 mph
    const r = analyzeDragRun(s)!;
    expect(r.topSpeedMph).toBeLessThan(130);
    expect(r.speedRuns.find((x) => x.toMph === 130)!.timeMs).toBeNull();
    expect(r.speedRuns.find((x) => x.fromMph === 60 && x.toMph === 130)!.timeMs).toBeNull();
    // But 0-60 was reached, so it still reports.
    expect(r.speedRuns.find((x) => x.toMph === 60)!.timeMs).not.toBeNull();
  });

  it("reports null distances for a run that stops short of the quarter", () => {
    const s = constantAccelRun(1, 10, 25); // ~50 m covered
    const r = analyzeDragRun(s)!;
    expect(r.distanceRuns.find((d) => d.distanceM === QUARTER_MILE_M)!.timeMs).toBeNull();
    expect(r.distanceRuns.find((d) => d.distanceM === QUARTER_MILE_M)!.trapSpeedMph).toBeNull();
  });

  it("a 91 mph unicycle run reports — the upper brackets are not clamped away", () => {
    // High-end EUCs really do reach the high 80s/low 90s. If the tool quietly
    // capped at a car-ish ceiling, this would come back null.
    const s = constantAccelRun(3, 30, 25);
    const r = analyzeDragRun(s)!;
    expect(r.topSpeedMph).toBeGreaterThan(91);
    expect(r.speedRuns.find((x) => x.toMph === 130)!.timeMs).not.toBeNull();
  });

  it("returns null for a trace too short to say anything", () => {
    expect(analyzeDragRun([])).toBeNull();
    expect(analyzeDragRun(constantAccelRun(4, 0, 25).slice(0, 1))).toBeNull();
  });
});

describe("cumulativeDistanceM", () => {
  it("is zero at the launch and monotonic after it", () => {
    const s = constantAccelRun(4, 10, 25, 1000);
    const launch = findLaunchIndex(s);
    const d = cumulativeDistanceM(s, launch);
    expect(d[launch]).toBe(0);
    for (let i = launch + 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
  });

  it("matches s = ½·a·t² over the run", () => {
    const s = constantAccelRun(4, 10, 25);
    const d = cumulativeDistanceM(s, 0);
    const last = s[s.length - 1];
    const expected = 0.5 * 4 * (last.t / 1000) ** 2;
    expect(d[d.length - 1]).toBeCloseTo(expected, -1); // within ~10 m over 200 m
  });
});

describe("rateWarning — a slow logger must be called out", () => {
  it("grades 25 Hz good", () => {
    const r = rateWarning(constantAccelRun(4, 10, 25));
    expect(r.hz).toBeCloseTo(25, 0);
    expect(r.grade).toBe("good");
  });

  it("grades 1 Hz poor, and says how far the board travels between fixes", () => {
    const r = rateWarning(constantAccelRun(4, 10, 1));
    expect(r.hz).toBeCloseTo(1, 0);
    expect(r.grade).toBe("poor");
    // The number that makes the warning concrete: 27 m between fixes at 60 mph.
    expect(r.metresPerFixAt60Mph).toBeCloseTo(26.8, 0);
  });

  it("grades 5 Hz marginal — usable for a 0-30, misleading for a trap speed", () => {
    expect(rateWarning(constantAccelRun(4, 10, 5)).grade).toBe("marginal");
  });

  it("a 10 Hz logger is the threshold of good", () => {
    expect(rateWarning(constantAccelRun(4, 10, 10)).grade).toBe("good");
    expect(rateWarning(constantAccelRun(4, 10, 10)).metresPerFixAt60Mph).toBeCloseTo(2.68, 1);
  });
});
