import { describe, it, expect } from "vitest";
import {
  projectToPlane,
  calculateDistanceArray,
  calculatePace,
  calculateReferenceSpeed,
  computeReferenceData,
  alignByDistance,
  alignValuesByDistance,
  mapIndexByDistance,
  interpolateSampleByDistance,
  anchorSampleTimes,
} from "./referenceUtils";
import { EARTH_RADIUS_M } from "./parserUtils";
import type { GpsSample } from "@/types/racing";

// Reference-lap comparison: equirectangular projection, cumulative arc-length,
// and distance-aligned pace / speed interpolation. Pure math — no DOM.

function sample(
  t: number,
  lat: number,
  lon: number,
  speedMph = 0,
  speedKph = 0
): GpsSample {
  return { t, lat, lon, speedMps: 0, speedMph, speedKph, extraFields: {} };
}

// ─── projectToPlane ─────────────────────────────────────────────────────────

describe("projectToPlane", () => {
  it("returns (0,0) at the projection center", () => {
    expect(projectToPlane(40, -74, 40, -74)).toEqual({ x: 0, y: 0 });
  });

  it("maps 1° of latitude north to ~111195 m on the y axis", () => {
    const p = projectToPlane(1, 0, 0, 0);
    // 1° = (π/180) * R
    expect(p.y).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_M, 0);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it("scales longitude by cos(latitude)", () => {
    // At 60° latitude, 1° of longitude spans half the equatorial distance.
    const atEquator = projectToPlane(0, 1, 0, 0).x;
    const at60 = projectToPlane(60, 1, 60, 0).x;
    expect(at60).toBeCloseTo(atEquator * Math.cos((60 * Math.PI) / 180), 3);
  });

  it("is signed: west/south of center give negative coordinates", () => {
    const p = projectToPlane(39, -75, 40, -74);
    expect(p.x).toBeLessThan(0); // lon less than center → negative x
    expect(p.y).toBeLessThan(0); // lat less than center → negative y
  });
});

// ─── calculateDistanceArray ──────────────────────────────────────────────────

describe("calculateDistanceArray", () => {
  it("returns [] for empty input", () => {
    expect(calculateDistanceArray([])).toEqual([]);
  });

  it("returns [0] for a single sample", () => {
    expect(calculateDistanceArray([sample(0, 40, -74)])).toEqual([0]);
  });

  it("is monotonically non-decreasing and starts at 0", () => {
    const samples = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.001),
      sample(3000, 40.003, -74.0),
    ];
    const d = calculateDistanceArray(samples);
    expect(d[0]).toBe(0);
    for (let i = 1; i < d.length; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    }
    expect(d.length).toBe(samples.length);
  });

  it("computes roughly correct distance for a small straight north hop", () => {
    // ~0.001° lat ≈ 111.195 m
    const samples = [sample(0, 40.0, -74.0), sample(1000, 40.001, -74.0)];
    const d = calculateDistanceArray(samples);
    expect(d[1]).toBeCloseTo(111.195, 0);
  });

  it("accumulates segment distances (two equal hops ≈ 2x one hop)", () => {
    const samples = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.0),
    ];
    const d = calculateDistanceArray(samples);
    expect(d[2]).toBeCloseTo(d[1] * 2, 1);
  });
});

// ─── calculatePace ──────────────────────────────────────────────────────────

describe("calculatePace", () => {
  it("returns [] when either lap is empty", () => {
    expect(calculatePace([], [sample(0, 40, -74)])).toEqual([]);
    expect(calculatePace([sample(0, 40, -74)], [])).toEqual([]);
  });

  it("returns ~0 pace when current lap is identical to reference", () => {
    const lap = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.0),
    ];
    // identical reference (cloned)
    const ref = lap.map((s) => ({ ...s }));
    const pace = calculatePace(lap, ref);
    expect(pace).toHaveLength(3);
    for (const p of pace) {
      expect(p).not.toBeNull();
      expect(p as number).toBeCloseTo(0, 6);
    }
  });

  it("reports positive pace (behind) when current lap is slower over same path", () => {
    // Same geometry; current lap takes twice as long → behind at matching distances.
    const ref = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.0),
    ];
    const slow = [
      sample(0, 40.0, -74.0),
      sample(2000, 40.001, -74.0),
      sample(4000, 40.002, -74.0),
    ];
    const pace = calculatePace(slow, ref);
    // first sample at distance 0 → both at t=0 → pace 0
    expect(pace[0] as number).toBeCloseTo(0, 6);
    // later samples: current is later than ref at equal distance → positive
    expect(pace[1] as number).toBeGreaterThan(0);
    expect(pace[2] as number).toBeGreaterThan(0);
  });

  it("reports negative pace (ahead) when current lap is faster", () => {
    const ref = [
      sample(0, 40.0, -74.0),
      sample(2000, 40.001, -74.0),
      sample(4000, 40.002, -74.0),
    ];
    const fast = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.0),
    ];
    const pace = calculatePace(fast, ref);
    expect(pace[1] as number).toBeLessThan(0);
    expect(pace[2] as number).toBeLessThan(0);
  });

  it("yields null where current distance exceeds the reference lap length", () => {
    // Current lap travels farther than the (short) reference.
    const ref = [sample(0, 40.0, -74.0), sample(1000, 40.001, -74.0)];
    const longer = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.003, -74.0), // beyond ref's total distance
    ];
    const pace = calculatePace(longer, ref);
    expect(pace[pace.length - 1]).toBeNull();
  });

  it("normalizes both laps to their own start time (offset-independent)", () => {
    const lap = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.0),
    ];
    // Reference identical geometry/timing but shifted +500000 ms absolute.
    const refShifted = lap.map((s) => ({ ...s, t: s.t + 500000 }));
    const pace = calculatePace(lap, refShifted);
    for (const p of pace) {
      expect(p as number).toBeCloseTo(0, 6);
    }
  });
});

// ─── calculateReferenceSpeed ─────────────────────────────────────────────────

describe("calculateReferenceSpeed", () => {
  it("returns [] when either lap is empty", () => {
    expect(calculateReferenceSpeed([], [sample(0, 40, -74)], false)).toEqual([]);
    expect(calculateReferenceSpeed([sample(0, 40, -74)], [], false)).toEqual([]);
  });

  it("returns reference mph at matching distances when useKph is false", () => {
    const ref = [
      sample(0, 40.0, -74.0, 50 /*mph*/, 80 /*kph*/),
      sample(1000, 40.001, -74.0, 60, 96),
      sample(2000, 40.002, -74.0, 70, 112),
    ];
    const current = ref.map((s) => ({ ...s }));
    const speeds = calculateReferenceSpeed(current, ref, false);
    expect(speeds[0]).toBeCloseTo(50, 6);
    expect(speeds[2]).toBeCloseTo(70, 6);
  });

  it("returns reference kph when useKph is true", () => {
    const ref = [
      sample(0, 40.0, -74.0, 50, 80),
      sample(1000, 40.001, -74.0, 60, 96),
    ];
    const current = ref.map((s) => ({ ...s }));
    const speeds = calculateReferenceSpeed(current, ref, true);
    expect(speeds[0]).toBeCloseTo(80, 6);
    expect(speeds[1]).toBeCloseTo(96, 6);
  });

  it("interpolates speed at an intermediate distance", () => {
    // The reference spans 40→60 mph over ~0.002° of latitude. The current lap's
    // SECOND sample sits halfway along that span (~0.001°), so the ref speed at
    // that distance interpolates to the midpoint. (The first current sample is
    // always at cumulative distance 0, so it pins to the ref's first speed, 40.)
    const ref = [
      sample(0, 40.0, -74.0, 40, 0),
      sample(1000, 40.002, -74.0, 60, 0),
    ];
    const current = [
      sample(0, 40.0, -74.0, 999, 0), // distance 0 → ref start
      sample(1000, 40.001, -74.0, 999, 0), // halfway in distance → midpoint
    ];
    const speeds = calculateReferenceSpeed(current, ref, false);
    expect(speeds[0] as number).toBeCloseTo(40, 1); // distance 0 → ref's first speed
    expect(speeds[1] as number).toBeCloseTo(50, 0); // midway between 40 and 60
  });

  it("returns null past the end of the reference lap", () => {
    const ref = [sample(0, 40.0, -74.0, 50, 0), sample(1000, 40.001, -74.0, 60, 0)];
    const current = [
      sample(0, 40.0, -74.0, 0, 0),
      sample(1000, 40.003, -74.0, 0, 0), // beyond ref distance
    ];
    const speeds = calculateReferenceSpeed(current, ref, false);
    expect(speeds[speeds.length - 1]).toBeNull();
  });
});

// ─── computeReferenceData ────────────────────────────────────────────────────

describe("computeReferenceData", () => {
  it("returns zeroed totalDistance for empty samples", () => {
    const ref = computeReferenceData([]);
    expect(ref.samples).toEqual([]);
    expect(ref.distances).toEqual([]);
    expect(ref.totalDistance).toBe(0);
  });

  it("totalDistance equals the last cumulative distance", () => {
    const samples = [
      sample(0, 40.0, -74.0),
      sample(1000, 40.001, -74.0),
      sample(2000, 40.002, -74.0),
    ];
    const ref = computeReferenceData(samples);
    expect(ref.samples).toBe(samples);
    expect(ref.distances).toHaveLength(3);
    expect(ref.totalDistance).toBe(ref.distances[2]);
    expect(ref.totalDistance).toBeGreaterThan(0);
  });

  it("totalDistance is 0 for a single sample", () => {
    const ref = computeReferenceData([sample(0, 40, -74)]);
    expect(ref.totalDistance).toBe(0);
  });
});

// ─── alignByDistance ────────────────────────────────────────────────────────

describe("alignByDistance", () => {
  // A lap heading north (lon fixed) with a per-sample channel value.
  function lapWithValues(vals: number[], spacingDeg = 0.0001): GpsSample[] {
    return vals.map((v, i) => ({
      t: i * 100,
      lat: 40 + i * spacingDeg,
      lon: -74,
      speedMps: 0,
      speedMph: 0,
      speedKph: 0,
      extraFields: { v },
    }));
  }

  it("interpolates the other lap's value at each current-sample distance", () => {
    const current = lapWithValues([10, 20, 30]);
    const other = lapWithValues([100, 200, 300]); // identical geometry
    const out = alignByDistance(current, other, (s) => s.extraFields.v);
    expect(out[0]).toBeCloseTo(100, 6);
    expect(out[1]).toBeCloseTo(200, 6);
    expect(out[2]).toBeCloseTo(300, 6);
  });

  it("returns null past the end of the other lap", () => {
    const current = lapWithValues([1, 2, 3, 4]); // longer
    const other = lapWithValues([10, 20]); // shorter — ends earlier
    const out = alignByDistance(current, other, (s) => s.extraFields.v);
    expect(out[out.length - 1]).toBeNull();
  });

  it("returns [] for empty input", () => {
    expect(alignByDistance([], lapWithValues([1]), (s) => s.extraFields.v)).toEqual([]);
  });
});

// ─── alignValuesByDistance ───────────────────────────────────────────────────

describe("alignValuesByDistance", () => {
  // A lap heading north (lon fixed); values live in a parallel array, not on
  // the sample — mirrors a derived series such as computed brake %.
  function lap(count: number, spacingDeg = 0.0001): GpsSample[] {
    return Array.from({ length: count }, (_, i) => ({
      t: i * 100,
      lat: 40 + i * spacingDeg,
      lon: -74,
      speedMps: 0,
      speedMph: 0,
      speedKph: 0,
      extraFields: {},
    }));
  }

  it("interpolates the parallel value array at each current-sample distance", () => {
    const out = alignValuesByDistance(lap(3), lap(3), [100, 200, 300]);
    expect(out[0]).toBeCloseTo(100, 6);
    expect(out[1]).toBeCloseTo(200, 6);
    expect(out[2]).toBeCloseTo(300, 6);
  });

  it("returns null past the end of the other lap", () => {
    const out = alignValuesByDistance(lap(4), lap(2), [10, 20]);
    expect(out[out.length - 1]).toBeNull();
  });

  it("treats null/undefined source values as gaps", () => {
    const out = alignValuesByDistance(lap(2), lap(2), [null, 50]);
    expect(out[0]).toBeNull();
  });

  it("returns [] for empty input", () => {
    expect(alignValuesByDistance([], lap(1), [1])).toEqual([]);
  });
});

// ─── mapIndexByDistance ──────────────────────────────────────────────────────

describe("mapIndexByDistance", () => {
  it("returns 0 for empty arrays", () => {
    expect(mapIndexByDistance([], [0, 1, 2], 1)).toBe(0);
    expect(mapIndexByDistance([0, 1, 2], [], 1)).toBe(0);
  });

  it("maps endpoints to endpoints", () => {
    const from = [0, 10, 20, 30];
    const to = [0, 5, 10, 15, 20, 25, 30];
    expect(mapIndexByDistance(from, to, 0)).toBe(0);
    expect(mapIndexByDistance(from, to, from.length - 1)).toBe(to.length - 1);
  });

  it("snaps to the nearest sample at the same cumulative distance", () => {
    const from = [0, 10, 20, 30];
    const to = [0, 5, 10, 15, 20, 25, 30];
    // distance 10 → exact match at to-index 2
    expect(mapIndexByDistance(from, to, 1)).toBe(2);
    // distance 20 → exact match at to-index 4
    expect(mapIndexByDistance(from, to, 2)).toBe(4);
  });

  it("picks the closer bracket when the distance falls between samples", () => {
    const from = [0, 12]; // target 12
    const to = [0, 10, 20]; // 12 is closer to 10 (idx 1) than 20 (idx 2)
    expect(mapIndexByDistance(from, to, 1)).toBe(1);
    const from2 = [0, 18]; // 18 is closer to 20 (idx 2)
    expect(mapIndexByDistance(from2, to, 1)).toBe(2);
  });

  it("clamps an out-of-bounds source index", () => {
    const from = [0, 10, 20];
    const to = [0, 10, 20];
    expect(mapIndexByDistance(from, to, 99)).toBe(2);
    expect(mapIndexByDistance(from, to, -5)).toBe(0);
  });

  it("clamps a target beyond the other lap's length to its last sample", () => {
    const from = [0, 50]; // longer lap
    const to = [0, 10, 20]; // shorter lap, max distance 20
    expect(mapIndexByDistance(from, to, 1)).toBe(2);
  });
});

// ─── interpolateSampleByDistance ────────────────────────────────────────────

describe("interpolateSampleByDistance", () => {
  // Two samples 100 m apart (1° lon ≈ 111195·cos(0) m at the equator is large, so
  // use a tiny lon step) — distances are computed by calculateDistanceArray.
  const samples = [
    sample(1000, 0, 0, 10, 16),
    sample(2000, 0, 0.001, 30, 48),
  ];
  const distances = calculateDistanceArray(samples);

  it("returns the exact sample time at an on-sample distance", () => {
    expect(interpolateSampleByDistance(samples, distances, 0).t).toBe(1000);
    const max = distances[distances.length - 1];
    expect(interpolateSampleByDistance(samples, distances, max).t).toBe(2000);
  });

  it("linearly interpolates t and coords at the midpoint", () => {
    const mid = distances[distances.length - 1] / 2;
    const s = interpolateSampleByDistance(samples, distances, mid);
    expect(s.t).toBeCloseTo(1500, 6);
    expect(s.lon).toBeCloseTo(0.0005, 9);
    expect(s.speedMph).toBeCloseTo(20, 6);
    expect(s.speedKph).toBeCloseTo(32, 6);
  });

  it("clamps below 0 to the first sample and above max to the last", () => {
    expect(interpolateSampleByDistance(samples, distances, -100).t).toBe(1000);
    expect(interpolateSampleByDistance(samples, distances, 1e9).t).toBe(2000);
  });

  it("guards empty input", () => {
    expect(interpolateSampleByDistance([], [], 0).t).toBe(0);
  });
});

// ─── anchorSampleTimes ──────────────────────────────────────────────────────

describe("anchorSampleTimes", () => {
  it("replaces only the endpoint times, leaving the interior untouched", () => {
    const samples = [sample(950, 0, 0), sample(1050, 0, 0.0005), sample(1140, 0, 0.001)];
    const out = anchorSampleTimes(samples, 1000, 1150);
    expect(out[0].t).toBe(1000);
    expect(out[1].t).toBe(1050); // interior unchanged
    expect(out[2].t).toBe(1150);
    expect(samples[0].t).toBe(950); // input not mutated
  });

  it("returns the input unchanged when empty", () => {
    expect(anchorSampleTimes([], 0, 0)).toEqual([]);
  });

  // Regression for the split-graphs per-lap video drift: a lap sliced on integer
  // indices starts a sub-sample fraction *before* the true crossing. After
  // anchoring, interpolating at distance 0 lands exactly on the lap's true start
  // time (and at full distance on its end time) — zero per-lap anchor drift.
  it("anchors distance-0/end to the lap's true crossing times", () => {
    const lapStartMs = 40000; // true interpolated start crossing
    const lapEndMs = 80000; // true interpolated end crossing
    // First/last raw samples sit before/within the crossing (the bug source).
    const raw = [
      sample(39950, 0, 0),
      sample(40050, 0, 0.0005),
      sample(79900, 0, 0.001),
    ];
    const anchored = anchorSampleTimes(raw, lapStartMs, lapEndMs);
    const d = calculateDistanceArray(anchored);
    expect(interpolateSampleByDistance(anchored, d, 0).t).toBe(lapStartMs);
    expect(interpolateSampleByDistance(anchored, d, d[d.length - 1]).t).toBe(lapEndMs);
  });
});
