import { describe, it, expect } from "vitest";
import { detectGpsGaps, totalGapMs, formatGapDuration, DEFAULT_GPS_GAP_THRESHOLD_MS } from "./gpsGaps";
import type { GpsSample } from "@/types/racing";

function sample(t: number, lat: number, lon: number): GpsSample {
  return { t, lat, lon, speedMps: 0, speedMph: 0, speedKph: 0, extraFields: {} };
}

describe("detectGpsGaps", () => {
  it("finds nothing in a normally-sampled session", () => {
    const samples = Array.from({ length: 100 }, (_, i) => sample(i * 1000, 32 + i * 0.0001, -117));
    expect(detectGpsGaps(samples)).toEqual([]);
  });

  it("flags a long gap between two consecutive samples", () => {
    const samples = [
      sample(0, 32.7, -117.2),
      sample(1000, 32.701, -117.201),
      sample(1_000_000, 32.9, -117.5), // 999s later, far away
      sample(1_001_000, 32.901, -117.501),
    ];
    const gaps = detectGpsGaps(samples);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ beforeIndex: 1, afterIndex: 2, durationMs: 999_000 });
    expect(gaps[0].distanceM).toBeGreaterThan(1000);
  });

  it("does not flag a gap right at the threshold boundary", () => {
    const samples = [sample(0, 0, 0), sample(DEFAULT_GPS_GAP_THRESHOLD_MS - 1, 0, 0)];
    expect(detectGpsGaps(samples)).toEqual([]);
  });

  it("flags a gap exactly at the threshold", () => {
    const samples = [sample(0, 0, 0), sample(DEFAULT_GPS_GAP_THRESHOLD_MS, 0, 0)];
    expect(detectGpsGaps(samples)).toHaveLength(1);
  });

  it("reproduces the real-world bug report: 2 samples, small time gap, large jump", () => {
    // From an actual recorded .dovep session: two fixes 2.9s apart but ~1km
    // apart — well under the time threshold, so this correctly stays
    // undetected as a "gap" (it's a GPS jump, not a recording dropout) —
    // documents that gap detection and teleportation filtering are separate
    // concerns, not a substitute for one another.
    const samples = [sample(0, 32.73785360, -117.25477110), sample(2863, 32.73121360, -117.24655420)];
    expect(detectGpsGaps(samples)).toEqual([]);
  });

  it("respects a custom threshold", () => {
    const samples = [sample(0, 0, 0), sample(5000, 0, 0)];
    expect(detectGpsGaps(samples, 5000)).toHaveLength(1);
    expect(detectGpsGaps(samples, 5001)).toEqual([]);
  });

  it("finds multiple separate gaps", () => {
    const samples = [
      sample(0, 0, 0),
      sample(20_000, 0, 0),
      sample(21_000, 0, 0),
      sample(50_000, 0, 0),
    ];
    const gaps = detectGpsGaps(samples);
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g) => g.beforeIndex)).toEqual([0, 2]);
  });
});

describe("totalGapMs", () => {
  it("sums durations across gaps", () => {
    const gaps = [
      { beforeIndex: 0, afterIndex: 1, durationMs: 20_000, distanceM: 100 },
      { beforeIndex: 2, afterIndex: 3, durationMs: 30_000, distanceM: 200 },
    ];
    expect(totalGapMs(gaps)).toBe(50_000);
  });

  it("returns 0 for no gaps", () => {
    expect(totalGapMs([])).toBe(0);
  });
});

describe("formatGapDuration", () => {
  it("formats seconds only", () => {
    expect(formatGapDuration(45_000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatGapDuration(5 * 60_000 + 30_000)).toBe("5m 30s");
  });

  it("formats hours and minutes, dropping seconds", () => {
    expect(formatGapDuration(60 * 60_000 + 5 * 60_000 + 30_000)).toBe("1h 5m");
  });
});
