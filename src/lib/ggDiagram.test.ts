import { describe, it, expect } from "vitest";
import { pickGForcePair, computeGGPoints, computeGGAxisMax } from "./ggDiagram";
import type { GpsSample } from "@/types/racing";

function sample(extra: Record<string, number>): GpsSample {
  return {
    t: 0,
    lat: 0,
    lon: 0,
    speedMps: 0,
    speedMph: 0,
    speedKph: 0,
    extraFields: extra,
  };
}

describe("pickGForcePair", () => {
  it("prefers the GPS pair for the gps source", () => {
    const samples = [sample({ lat_g: 0.5, lon_g: -0.3, lat_g_native: 0.4, lon_g_native: -0.2 })];
    expect(pickGForcePair(samples, "gps")).toMatchObject({ x: "lat_g", y: "lon_g", source: "GPS" });
  });

  it("prefers the native pair for the hw source when present", () => {
    const samples = [sample({ lat_g: 0.5, lon_g: -0.3, lat_g_native: 0.4, lon_g_native: -0.2 })];
    expect(pickGForcePair(samples, "hw")).toMatchObject({ x: "lat_g_native", y: "lon_g_native" });
  });

  it("falls back to whichever pair has data", () => {
    const onlyGps = [sample({ lat_g: 0.5, lon_g: -0.3 })];
    expect(pickGForcePair(onlyGps, "hw")).toMatchObject({ x: "lat_g", y: "lon_g" });
  });

  it("returns null when no g-force channels exist", () => {
    expect(pickGForcePair([sample({ rpm: 8000 })], "gps")).toBeNull();
  });
});

describe("computeGGPoints", () => {
  const pair = { x: "lat_g", y: "lon_g", source: "GPS" };

  it("pairs lateral and longitudinal values per sample", () => {
    const samples = [sample({ lat_g: 0.5, lon_g: -0.3 }), sample({ lat_g: -0.2, lon_g: 0.9 })];
    expect(computeGGPoints(samples, pair)).toEqual([
      { x: 0.5, y: -0.3 },
      { x: -0.2, y: 0.9 },
    ]);
  });

  it("returns null for samples missing either component (kept aligned to index)", () => {
    const samples = [sample({ lat_g: 0.5 }), sample({ lat_g: 0.1, lon_g: 0.1 })];
    const points = computeGGPoints(samples, pair);
    expect(points[0]).toBeNull();
    expect(points[1]).toEqual({ x: 0.1, y: 0.1 });
  });

  it("smooths each axis with a moving average when a window is given", () => {
    const samples = [
      sample({ lat_g: 0, lon_g: 0 }),
      sample({ lat_g: 3, lon_g: 3 }),
      sample({ lat_g: 0, lon_g: 0 }),
    ];
    const points = computeGGPoints(samples, pair, 3);
    // Middle point is the average of its 3-wide neighbourhood: (0+3+0)/3 = 1.
    expect(points[1]).toEqual({ x: 1, y: 1 });
  });
});

describe("computeGGAxisMax", () => {
  it("rounds the peak magnitude up to a clean 0.5 g ring-3", () => {
    const points = [{ x: 0.8, y: -1.1 }, { x: 0.2, y: 0.3 }];
    // peak 1.1 * 1.05 = 1.155 -> ceil to 1.5
    expect(computeGGAxisMax(points)).toBe(1.5);
  });

  it("clamps to a [1.5, 3.0] g window", () => {
    expect(computeGGAxisMax([{ x: 0.1, y: 0.1 }])).toBe(1.5); // floor
    expect(computeGGAxisMax([{ x: 4, y: 0 }])).toBe(3.0); // ceiling
  });

  it("covers every supplied point set (session + reference)", () => {
    const session = [{ x: 0.5, y: 0.5 }];
    const reference = [{ x: 0, y: -2.2 }];
    // reference peak 2.2 * 1.05 = 2.31 -> ceil to 2.5
    expect(computeGGAxisMax(session, reference)).toBe(2.5);
  });

  it("ignores null points and handles empty input", () => {
    expect(computeGGAxisMax([null, null])).toBe(1.5);
    expect(computeGGAxisMax()).toBe(1.5);
  });
});
