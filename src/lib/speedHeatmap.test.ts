/**
 * Unit tests for the bucketed speed-heatmap geometry (CR: the maps used to
 * build one SVG polyline per GPS segment; now segments group into ~20
 * color-bucket multi-polylines).
 */

import { describe, it, expect } from "vitest";
import {
  getSpeedColor,
  bucketIndexForSpeed,
  buildHeatmapSegments,
  HEATMAP_BUCKET_COUNT,
} from "./speedHeatmap";

function sample(lat: number, lon: number, speedMph: number) {
  return { lat, lon, speedMph };
}

// ─── getSpeedColor ──────────────────────────────────────────────────────────

describe("getSpeedColor", () => {
  it("returns green at the minimum speed", () => {
    expect(getSpeedColor(0, 0, 100)).toBe("rgb(76,175,80)");
  });

  it("returns red at the maximum speed", () => {
    expect(getSpeedColor(100, 0, 100)).toBe("rgb(200,40,40)");
  });

  it("clamps out-of-range speeds", () => {
    expect(getSpeedColor(-50, 0, 100)).toBe(getSpeedColor(0, 0, 100));
    expect(getSpeedColor(500, 0, 100)).toBe(getSpeedColor(100, 0, 100));
  });

  it("uses the gradient midpoint when the range is empty", () => {
    expect(getSpeedColor(42, 42, 42)).toBe(getSpeedColor(50, 0, 100));
  });
});

// ─── bucketIndexForSpeed ────────────────────────────────────────────────────

describe("bucketIndexForSpeed", () => {
  it("maps the range edges to the first and last buckets", () => {
    expect(bucketIndexForSpeed(0, 0, 100, 20)).toBe(0);
    expect(bucketIndexForSpeed(100, 0, 100, 20)).toBe(19);
  });

  it("clamps out-of-range speeds to the edge buckets", () => {
    expect(bucketIndexForSpeed(-10, 0, 100, 20)).toBe(0);
    expect(bucketIndexForSpeed(110, 0, 100, 20)).toBe(19);
  });

  it("returns 0 when the speed range is empty", () => {
    expect(bucketIndexForSpeed(50, 50, 50, 20)).toBe(0);
  });
});

// ─── buildHeatmapSegments ───────────────────────────────────────────────────

describe("buildHeatmapSegments", () => {
  it("returns no buckets for fewer than 2 samples", () => {
    expect(buildHeatmapSegments([], 0, 100)).toEqual([]);
    expect(buildHeatmapSegments([sample(1, 1, 50)], 0, 100)).toEqual([]);
  });

  it("chains consecutive same-bucket segments into one part", () => {
    // All samples at the same speed → one bucket, one part covering everything.
    const samples = [0, 1, 2, 3].map((i) => sample(i, i, 50));
    const buckets = buildHeatmapSegments(samples, 0, 100);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].parts).toHaveLength(1);
    expect(buckets[0].parts[0]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it("keeps parts continuous across bucket changes (shared point)", () => {
    // Segment i is colored by sample i's speed: segment 0-1 slow, segment 1-2 fast.
    const samples = [sample(0, 0, 5), sample(1, 1, 95), sample(2, 2, 95)];
    const buckets = buildHeatmapSegments(samples, 0, 100);
    expect(buckets).toHaveLength(2);
    const [slow, fast] = buckets;
    expect(slow.parts[0]).toEqual([[0, 0], [1, 1]]);
    // The fast part starts at the slow part's last point — no visual gap.
    expect(fast.parts[0]).toEqual([[1, 1], [2, 2]]);
  });

  it("never produces more than bucketCount layers, regardless of sample count", () => {
    // 10k samples sweeping the speed range repeatedly.
    const samples = Array.from({ length: 10_000 }, (_, i) =>
      sample(i, i, (i * 7) % 101),
    );
    const buckets = buildHeatmapSegments(samples, 0, 100);
    expect(buckets.length).toBeLessThanOrEqual(HEATMAP_BUCKET_COUNT);
    expect(buckets.length).toBeGreaterThan(1);
  });

  it("covers every segment exactly once across all parts", () => {
    const samples = Array.from({ length: 500 }, (_, i) => sample(i, i, (i * 13) % 80));
    const buckets = buildHeatmapSegments(samples, 0, 80);
    // Each part with k points covers k-1 segments; total must equal n-1.
    const segmentCount = buckets
      .flatMap((b) => b.parts)
      .reduce((acc, part) => acc + part.length - 1, 0);
    expect(segmentCount).toBe(samples.length - 1);
  });

  it("colors each bucket at its midpoint speed", () => {
    const samples = [sample(0, 0, 0), sample(1, 1, 0)];
    const buckets = buildHeatmapSegments(samples, 0, 100, 20);
    // Bucket 0 midpoint = 2.5 of 0–100.
    expect(buckets[0].color).toBe(getSpeedColor(2.5, 0, 100));
  });

  it("handles an empty speed range without dividing by zero", () => {
    const samples = [sample(0, 0, 50), sample(1, 1, 50), sample(2, 2, 50)];
    const buckets = buildHeatmapSegments(samples, 50, 50);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].parts[0]).toHaveLength(3);
  });
});
