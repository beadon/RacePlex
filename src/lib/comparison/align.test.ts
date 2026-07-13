import { describe, it, expect } from "vitest";
import type { GpsSample, Lap, ParsedData } from "@/types/racing";
import { alignSessionToLap, pickFastestLap, unionChannelIds } from "./align";

// A synthetic track: straight east from (42.5, -8.6), one sample per second,
// 10 m/s. 30 samples ≈ 300 m of easterly travel — enough to have a shape.
function sample(i: number, extraFields: Record<string, number> = {}): GpsSample {
  const lonPerMeter = 1 / (111_320 * Math.cos(42.5 * Math.PI / 180));
  return {
    t: i * 1000,
    lat: 42.5,
    lon: -8.6 + i * 10 * lonPerMeter,
    speedMps: 10,
    speedKph: 36,
    speedMph: 22.4,
    extraFields,
  };
}

function fixture(sampleCount = 30): ParsedData {
  const samples: GpsSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    samples.push(sample(i, { altitude: 100 + i * 2 })); // altitude ramps up
  }
  return {
    samples,
    fieldMappings: [{ index: -1, name: "Speed", enabled: true }],
    bounds: { minLat: 42.5, maxLat: 42.5, minLon: samples[0].lon, maxLon: samples[samples.length - 1].lon },
    duration: samples[samples.length - 1].t,
  };
}

function lap(overrides: Partial<Lap> = {}): Lap {
  return {
    lapNumber: 1,
    startTime: 0,
    endTime: 20_000,
    lapTimeMs: 20_000,
    maxSpeedKph: 36, maxSpeedMph: 22.4,
    minSpeedKph: 36, minSpeedMph: 22.4,
    startIndex: 0,
    endIndex: 20,
    ...overrides,
  };
}

describe("pickFastestLap", () => {
  it("returns null when the lap list is empty", () => {
    expect(pickFastestLap([])).toBeNull();
  });

  it("picks the lap with the smallest lapTimeMs", () => {
    const laps = [
      lap({ lapNumber: 1, lapTimeMs: 30_000 }),
      lap({ lapNumber: 2, lapTimeMs: 25_000 }),
      lap({ lapNumber: 3, lapTimeMs: 27_000 }),
    ];
    expect(pickFastestLap(laps)?.lapNumber).toBe(2);
  });
});

describe("alignSessionToLap", () => {
  it("returns an empty series when no lap is available", () => {
    const data = fixture();
    const s = alignSessionToLap("a.csv", data, [], null, 10);
    expect(s?.distances).toEqual([]);
    expect(s?.channels).toEqual({});
  });

  it("returns null on an out-of-range lap or a single-sample lap", () => {
    const data = fixture();
    expect(alignSessionToLap("a.csv", data, [], lap({ startIndex: 5, endIndex: 3 }))).toBeNull();
    expect(alignSessionToLap("a.csv", data, [], lap({ startIndex: 5, endIndex: 5 }))).toBeNull();
    expect(alignSessionToLap("a.csv", data, [], lap({ startIndex: 999, endIndex: 1000 }))).toBeNull();
  });

  it("resamples to exactly the requested count", () => {
    const data = fixture(30);
    const s = alignSessionToLap("a.csv", data, [], lap({ startIndex: 0, endIndex: 20 }), 50)!;
    expect(s.distances.length).toBe(50);
    expect(s.channels.speedMps.length).toBe(50);
    expect(s.timeMs.length).toBe(50);
  });

  it("produces monotonically increasing distances from 0 to totalDistanceM", () => {
    const data = fixture(30);
    const s = alignSessionToLap("a.csv", data, [], lap({ startIndex: 0, endIndex: 20 }), 20)!;
    expect(s.distances[0]).toBe(0);
    for (let i = 1; i < s.distances.length; i++) {
      expect(s.distances[i]).toBeGreaterThan(s.distances[i - 1]);
    }
    expect(s.distances[s.distances.length - 1]).toBeCloseTo(s.totalDistanceM, 6);
  });

  it("carries speed and extraFields through the resample", () => {
    const data = fixture(30);
    const s = alignSessionToLap("a.csv", data, [], lap({ startIndex: 0, endIndex: 20 }), 10)!;
    for (const v of s.channels.speedMps) expect(v).toBeCloseTo(10, 6);
    expect(s.channels.altitude).toBeDefined();
    // Altitude ramps 100 → 100 + 2*20 = 140 across the lap; midpoint ≈ 120.
    const mid = s.channels.altitude[Math.floor(s.channels.altitude.length / 2)];
    expect(mid).toBeGreaterThan(115);
    expect(mid).toBeLessThan(125);
  });

  it("times start at 0 at lap start", () => {
    const data = fixture(30);
    const s = alignSessionToLap("a.csv", data, [], lap({ startIndex: 5, endIndex: 20 }), 10)!;
    expect(s.timeMs[0]).toBe(0);
    // Lap has 15 samples × 1 s = 15 s of elapsed time.
    expect(s.timeMs[s.timeMs.length - 1]).toBeCloseTo(15_000, 0);
  });
});

describe("unionChannelIds", () => {
  it("puts speedMps first and dedupes the rest", () => {
    const s1 = { fileName: "a", lap: null, distances: [], timeMs: [],
      channels: { speedMps: [], altitude: [], rpm: [] },
      totalDistanceM: 0, lapTimeMs: 0 };
    const s2 = { fileName: "b", lap: null, distances: [], timeMs: [],
      channels: { speedMps: [], rpm: [], water_temp: [] },
      totalDistanceM: 0, lapTimeMs: 0 };
    expect(unionChannelIds([s1, s2])).toEqual(["speedMps", "altitude", "rpm", "water_temp"]);
  });

  it("returns just speedMps when the input is empty", () => {
    expect(unionChannelIds([])).toEqual(["speedMps"]);
  });
});
