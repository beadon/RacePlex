import { describe, it, expect } from "vitest";
import { RaceBoxCapture } from "./raceboxSession";
import type { RaceBoxSample } from "./raceboxDecoder";

function sample(overrides: Partial<RaceBoxSample> = {}): RaceBoxSample {
  return {
    iTOW: 0, year: 2025, month: 6, day: 15,
    hour: 14, minute: 30, second: 0, nanoseconds: 0,
    fixStatus: 3, fixStatusFlags: 0x01, fixOk: true, numSV: 12,
    latitude: 42.5, longitude: -8.6,
    altitudeM: 100, altitudeMslM: 95, hAccM: 2, vAccM: 3,
    speedMps: 0, headingDeg: 0, speedAccMps: 0.1, headingAccDeg: 1,
    pDOP: 1.5, batteryOrVoltage: 80,
    gForceXg: 0, gForceYg: 0, gForceZg: 1,
    rotRateXdps: 0, rotRateYdps: 0, rotRateZdps: 0,
    ...overrides,
  };
}

describe("RaceBoxCapture", () => {
  it("starts empty", () => {
    const cap = new RaceBoxCapture();
    const snap = cap.snapshot();
    expect(snap.count).toBe(0);
    expect(snap.startDate).toBeUndefined();
  });

  it("sets startDate from the first sample's UTC fields", () => {
    const cap = new RaceBoxCapture();
    cap.append(sample({ hour: 14, minute: 30, second: 45, nanoseconds: 500_000_000 }));
    expect(cap.snapshot().startDate?.toISOString()).toBe("2025-06-15T14:30:45.500Z");
  });

  it("emits t=0 for the first sample, t=elapsed-ms for the next", () => {
    const cap = new RaceBoxCapture();
    cap.append(sample({ second: 0 }));
    cap.append(sample({ second: 1 }));
    cap.append(sample({ second: 2, nanoseconds: 500_000_000 }));
    const snap = cap.snapshot();
    expect(snap.samples.map((s) => s.t)).toEqual([0, 1000, 2500]);
  });

  it("drops duplicates and non-monotonic samples", () => {
    const cap = new RaceBoxCapture();
    cap.append(sample({ second: 0 }));
    cap.append(sample({ second: 0 })); // duplicate — drop
    cap.append(sample({ second: 1 }));
    cap.append(sample({ second: 0 })); // backwards — drop
    expect(cap.snapshot().count).toBe(2);
  });

  it("maps decoded fields into the standard ParsedData channels", () => {
    const cap = new RaceBoxCapture();
    cap.append(sample({
      latitude: 42.5001, longitude: -8.6001, speedMps: 15,
      headingDeg: 90, altitudeM: 200, hAccM: 3.2,
      gForceXg: 0.8, gForceYg: -0.4, rotRateZdps: 30,
      numSV: 14, pDOP: 1.2,
    }));
    const [row] = cap.snapshot().samples;
    expect(row.lat).toBe(42.5001);
    expect(row.lon).toBe(-8.6001);
    expect(row.speedMps).toBe(15);
    expect(row.heading).toBe(90);
    expect(row.extraFields["Altitude (m)"]).toBe(200);
    expect(row.extraFields["Lat G (Native)"]).toBe(-0.4);
    expect(row.extraFields["Lon G (Native)"]).toBe(0.8);
    expect(row.extraFields["Yaw Rate"]).toBe(30);
    expect(row.extraFields["Satellites"]).toBe(14);
    expect(row.extraFields["HDOP"]).toBe(1.2);
  });

  it("toParsedData reports duration = last sample's t", () => {
    const cap = new RaceBoxCapture();
    cap.append(sample({ second: 0 }));
    cap.append(sample({ second: 10 }));
    expect(cap.toParsedData().duration).toBe(10_000);
  });

  it("toParsedData over an empty capture reports duration 0", () => {
    expect(new RaceBoxCapture().toParsedData().duration).toBe(0);
  });
});
