// Known-answer tests for the GoPro GPMF decode + mapping, driven by the real
// pre-extracted GPMF payloads vendored in `src/lib/__fixtures__/` (see NOTICE).
//
// These are the actual bytes of the `gpmd` track from a HERO5 and a HERO11, so
// they exercise the whole chain except the mp4 demux itself: gopro-telemetry's
// decode, our stream selection (GPS9 over GPS5), the unit handling, the IMU
// merge, and the timebase.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { decodeGpmf } from "./gpmfDecode";
import { NoGoProGpsError, mapGpmfToParsedData } from "./gpmfMapping";
import type { GpmfDevices } from "./gpmfTypes";
import { normalizeChannels } from "../channels";
import { MPS_TO_MPH, haversineDistance } from "../parserUtils";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, "../__fixtures__", name)));

const hero5 = fixture("gopro-hero5.raw");
const hero11 = fixture("gopro-hero11.raw");

describe("decodeGpmf — the vendored HERO5 payload (GPS5, ~18 Hz)", () => {
  it("finds the GPS5 stream and reports its units in m/s", async () => {
    const devices = await decodeGpmf(hero5);
    const gps = devices["1"]?.streams?.GPS5;

    expect(gps).toBeDefined();
    // The units are read, never assumed — this is the assertion that catches a
    // future library change turning speed into km/h under us.
    expect(gps!.units).toEqual(["deg", "deg", "m", "m/s", "m/s"]);
    expect(gps!.samples.length).toBeGreaterThan(10);
  });

  it("maps to plausible coordinates, a sane sample rate and monotonic time", async () => {
    const data = mapGpmfToParsedData(await decodeGpmf(hero5));

    expect(data.samples.length).toBeGreaterThan(10);

    // Oceanside, California — where GoPro's own HERO5 sample was shot.
    expect(data.bounds.minLat).toBeGreaterThan(33.1);
    expect(data.bounds.maxLat).toBeLessThan(33.2);
    expect(data.bounds.minLon).toBeGreaterThan(-117.4);
    expect(data.bounds.maxLon).toBeLessThan(-117.3);

    // Strictly increasing, rebased to zero.
    expect(data.samples[0].t).toBe(0);
    for (let i = 1; i < data.samples.length; i++) {
      expect(data.samples[i].t).toBeGreaterThan(data.samples[i - 1].t);
    }
    expect(data.duration).toBe(data.samples[data.samples.length - 1].t);

    // GPS5 on a HERO5 is 18 Hz.
    const rate = (data.samples.length - 1) / (data.duration / 1000);
    expect(rate).toBeGreaterThan(15);
    expect(rate).toBeLessThan(20);
  });

  it("takes the wall clock from the GPS UTC fix, not from the MP4", async () => {
    const data = mapGpmfToParsedData(await decodeGpmf(hero5));
    expect(data.startDate?.toISOString()).toBe("2017-04-17T17:31:03.000Z");
  });

  it("brings the accelerometer and gyro along on the GPS timebase", async () => {
    const data = mapGpmfToParsedData(await decodeGpmf(hero5));
    const s = data.samples[0];

    // ACCL is m/s²; we publish G. At rest one axis reads ~1 g and no axis is absurd.
    const accel = [s.extraFields["Accel X"], s.extraFields["Accel Y"], s.extraFields["Accel Z"]];
    for (const a of accel) {
      expect(a).toBeDefined();
      expect(Math.abs(a)).toBeLessThan(5);
    }
    expect(Math.max(...accel.map(Math.abs))).toBeGreaterThan(0.8);

    // GYRO is rad/s; we publish °/s. A handheld camera is not spinning at 1000°/s.
    expect(Math.abs(s.extraFields["Yaw Rate"])).toBeLessThan(720);

    expect(s.extraFields["Altitude (m)"]).toBeDefined();
    expect(s.extraFields["HDOP"]).toBeCloseTo(6.06, 2); // GPS5 sticky precision 606 / 100

    const names = data.fieldMappings.map((f) => f.name);
    expect(names).toEqual([
      "Speed",
      "Altitude (m)",
      "HDOP",
      "Accel X",
      "Accel Y",
      "Accel Z",
      "Yaw Rate",
    ]);
  });

  it("survives channel normalization with every field mapped to a canonical id", async () => {
    const data = normalizeChannels(mapGpmfToParsedData(await decodeGpmf(hero5)));
    const names = data.fieldMappings.map((f) => f.name);

    expect(names).toContain("altitude");
    expect(names).toContain("hdop");
    expect(names).toContain("accel_x");
    expect(names).toContain("yaw_rate");
    // Every extra channel resolved to a canonical id — none fell through to a
    // `custom:` slug. ("Speed" is the primary channel and has no id, exactly as
    // in the GPX parser.)
    expect(names.filter((n) => n.startsWith("custom:"))).toEqual(["custom:speed"]);
    expect(Object.keys(data.samples[0].extraFields)).toContain("accel_z");
  });
});

describe("decodeGpmf — the vendored HERO11 payload (GPS9, ~10 Hz)", () => {
  it("prefers GPS9 over GPS5 when the camera writes both", async () => {
    const devices = await decodeGpmf(hero11);
    // A HERO11 writes both streams; GPS9 is the one with per-sample fix + DOP.
    expect(devices["1"]?.streams?.GPS9).toBeDefined();
    expect(devices["1"]?.streams?.GPS5).toBeDefined();

    const data = mapGpmfToParsedData(devices);
    // GPS9 carries a real per-sample DOP (1.79 on the first fix); GPS5's sticky
    // precision for the same recording is 179 (= ×100), so picking the wrong
    // stream would show up here.
    expect(data.samples[0].extraFields["HDOP"]).toBeCloseTo(1.79, 2);
  });

  it("maps to plausible coordinates, a sane sample rate and monotonic time", async () => {
    const data = mapGpmfToParsedData(await decodeGpmf(hero11));

    expect(data.samples.length).toBeGreaterThan(100);

    // Pontevedra, Galicia.
    expect(data.bounds.minLat).toBeGreaterThan(42.4);
    expect(data.bounds.maxLat).toBeLessThan(42.5);
    expect(data.bounds.minLon).toBeGreaterThan(-8.7);
    expect(data.bounds.maxLon).toBeLessThan(-8.6);

    expect(data.samples[0].t).toBe(0);
    for (let i = 1; i < data.samples.length; i++) {
      expect(data.samples[i].t).toBeGreaterThan(data.samples[i - 1].t);
    }

    // GPS9 on a HERO11 is 10 Hz.
    const rate = (data.samples.length - 1) / (data.duration / 1000);
    expect(rate).toBeGreaterThan(8);
    expect(rate).toBeLessThan(12);

    expect(data.startDate?.toISOString()).toBe("2022-09-20T13:29:36.898Z");
  });
});

/**
 * The unit trap this importer has to avoid: GoPro's speed column is m/s. Read it
 * as km/h and a 20 mph run reports 45 mph; read it as knots and it is worse.
 *
 * The primary guard is the `units` array the library reports alongside the data
 * (asserted above) — the instruction was to CONFIRM the unit from the output, not
 * to assume it. This is the corroborating check against the positions.
 *
 * Both vendored fixtures are near-stationary cameras, which makes the naive check
 * — integrate reported speed, compare to the haversine path length — actively
 * dangerous: the path length is dominated by GPS jitter, and a ×3.6 km/h misread
 * would move the integral CLOSER to it, so that test would reward the bug. What
 * IS sound is the direction of the error: position noise can only ever inflate
 * the derived speed, so true reported speed must sit UNDER the derived speed.
 * Scale it up by 3.6 (km/h) or 1.94 (knots) and it breaks through that ceiling.
 */
describe("speed scale — reported speed is bounded by what the positions can justify", () => {
  it.each([
    ["HERO5", hero5],
    ["HERO11", hero11],
  ])("%s: reported speed stays under the (noise-inflated) haversine speed", async (_n, raw) => {
    const data = mapGpmfToParsedData(await decodeGpmf(raw));

    const derived: number[] = [];
    for (let i = 1; i < data.samples.length; i++) {
      const a = data.samples[i - 1];
      const b = data.samples[i];
      const dt = (b.t - a.t) / 1000;
      derived.push(haversineDistance(a.lat, a.lon, b.lat, b.lon) / dt);
    }
    const reported = data.samples.map((s) => s.speedMps);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    expect(Math.max(...reported)).toBeLessThan(Math.max(...derived));
    expect(mean(reported)).toBeLessThan(mean(derived));

    // ...and it is not zero either, so the ceiling above is a real constraint and
    // not a vacuous "0 < noise".
    expect(Math.max(...reported)).toBeGreaterThan(0.1);

    // Nothing pathological: neither fixture is a 400 km/h bike ride.
    const maxMph = Math.max(...data.samples.map((s) => s.speedMph));
    expect(maxMph).toBeLessThan(15);
    expect(data.samples[0].speedMph).toBeCloseTo(data.samples[0].speedMps * MPS_TO_MPH, 6);
  });

  it("passes the m/s value through untouched — no scaling of any kind", () => {
    const data = mapGpmfToParsedData({
      "1": {
        streams: {
          GPS9: {
            units: ["deg", "deg", "m", "m/s", "m/s", "", "s", "", ""],
            samples: [
              // 2D speed 12 m/s, 3D speed 13 m/s: we must take the 2D (ground) one.
              { value: [42.4, -8.6, 30, 12, 13, 0, 0, 1.5, 3], cts: 0 },
              { value: [42.4, -8.6, 30, 12, 13, 0, 0, 1.5, 3], cts: 100 },
            ],
          },
        },
      },
    });

    expect(data.samples[0].speedMps).toBe(12);
    expect(data.samples[0].speedKph).toBeCloseTo(43.2, 3);
    expect(data.samples[0].speedMph).toBeCloseTo(26.84, 1);
  });
});

describe("a video with no GPS explains itself", () => {
  it("names the HERO12 rather than throwing a stack trace", () => {
    // A HERO12: IMU, no GPS receiver at all.
    const devices: GpmfDevices = {
      "1": {
        "device name": "HERO12 Black",
        streams: {
          ACCL: { samples: [{ value: [9.8, 0, 0], cts: 0 }] },
        },
      },
    };

    expect(() => mapGpmfToParsedData(devices)).toThrow(NoGoProGpsError);
    expect(() => mapGpmfToParsedData(devices)).toThrow(/HERO12 has no GPS receiver/);
  });

  it("says so when the camera has a GPS stream but never got a lock", () => {
    const devices: GpmfDevices = {
      "1": {
        streams: {
          GPS9: {
            samples: [
              { value: [0, 0, 0, 0, 0, 0, 0, 99, 0], cts: 0 },
              { value: [0, 0, 0, 0, 0, 0, 0, 99, 0], cts: 100 },
            ],
          },
        },
      },
    };

    expect(() => mapGpmfToParsedData(devices)).toThrow(/never got a lock/);
  });

  it("drops the no-fix samples a GPS9 stream emits before it locks on", () => {
    const devices: GpmfDevices = {
      "1": {
        streams: {
          GPS9: {
            samples: [
              // Recording started; no lock yet.
              { value: [0, 0, 0, 0, 0, 0, 0, 99, 0], cts: 0 },
              { value: [42.4, -8.6, 30, 5, 5, 0, 0, 1.5, 3], cts: 100, date: "2022-09-20T13:29:37.000Z" },
              { value: [42.4001, -8.6001, 30, 5, 5, 0, 0, 1.5, 3], cts: 200 },
            ],
          },
        },
      },
    };

    const data = mapGpmfToParsedData(devices);
    expect(data.samples).toHaveLength(2);
    // Time is rebased onto the first VALID fix, not the first video frame.
    expect(data.samples[0].t).toBe(0);
    expect(data.samples[1].t).toBe(100);
    expect(data.startDate?.toISOString()).toBe("2022-09-20T13:29:37.000Z");
  });

  it("refuses a timeline that steps backwards (a repaired / chapter-joined file)", () => {
    const devices: GpmfDevices = {
      "1": {
        streams: {
          GPS9: {
            samples: [
              { value: [42.4, -8.6, 30, 1, 1, 0, 0, 1.5, 3], cts: 0 },
              { value: [42.4001, -8.6, 30, 1, 1, 0, 0, 1.5, 3], cts: 100 },
              { value: [42.4002, -8.6, 30, 1, 1, 0, 0, 1.5, 3], cts: 50 }, // backwards
              { value: [42.4003, -8.6, 30, 1, 1, 0, 0, 1.5, 3], cts: 200 },
            ],
          },
        },
      },
    };

    const data = mapGpmfToParsedData(devices);
    expect(data.samples.map((s) => s.t)).toEqual([0, 100, 200]);
  });
});
