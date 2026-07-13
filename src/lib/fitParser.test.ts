/**
 * FIT parser tests (issue #17). We don't have a real .fit fixture in the repo
 * (that would be its own contribution), so we test the pure mapper directly
 * with the ParsedFit shape `fit-file-parser` hands us — plus the sniff, which
 * only needs 12 bytes.
 */

import { describe, it, expect } from "vitest";
import { fitToParsedData, isFitFile } from "./fitParser";

/** Build the 12-byte FIT header prefix; the trailing ".FIT" is the magic. */
function fitMagicHeader(): ArrayBuffer {
  const buf = new Uint8Array(12);
  buf[0] = 14; // header size
  buf[1] = 32; // protocol version
  // profile version at [2..3], data size at [4..7] — irrelevant to sniff.
  buf[8] = 0x2e; // '.'
  buf[9] = 0x46; // 'F'
  buf[10] = 0x49; // 'I'
  buf[11] = 0x54; // 'T'
  return buf.buffer;
}

describe("isFitFile", () => {
  it("accepts a .fit extension", () => {
    expect(isFitFile("ride.fit")).toBe(true);
    expect(isFitFile("RIDE.FIT")).toBe(true);
  });

  it("accepts a renamed file by header magic", () => {
    expect(isFitFile("mystery.dat", fitMagicHeader())).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isFitFile("ride.csv")).toBe(false);
    expect(isFitFile("ride.gpx")).toBe(false);
    const notFit = new Uint8Array(12);
    // No magic — first 12 bytes are zeros.
    expect(isFitFile("mystery.dat", notFit.buffer)).toBe(false);
  });

  it("rejects a buffer that's too short to sniff", () => {
    expect(isFitFile("mystery.dat", new Uint8Array(4).buffer)).toBe(false);
  });
});

describe("fitToParsedData", () => {
  it("maps GPS records into samples, rebased onto t=0", () => {
    const t0 = new Date("2025-06-15T14:30:00.000Z");
    const parsed = {
      records: [
        { timestamp: t0, position_lat: 42.5, position_long: -8.6, speed: 0, heart_rate: 90 },
        { timestamp: new Date(t0.getTime() + 1000), position_lat: 42.5001, position_long: -8.6, speed: 10, heart_rate: 120 },
        { timestamp: new Date(t0.getTime() + 2000), position_lat: 42.5002, position_long: -8.6, speed: 15, heart_rate: 140, power: 250 },
      ],
    };
    const data = fitToParsedData(parsed);
    expect(data.samples.length).toBe(3);
    expect(data.samples[0].t).toBe(0);
    expect(data.samples[1].t).toBe(1000);
    expect(data.samples[2].t).toBe(2000);
    expect(data.samples[1].speedMps).toBe(10);
    expect(data.samples[1].extraFields["Heart Rate"]).toBe(120);
    expect(data.samples[2].extraFields["Power (W)"]).toBe(250);
    expect(data.startDate?.getTime()).toBe(t0.getTime());
  });

  it("skips records missing lat/lon (an indoor workout has HR-only rows)", () => {
    const parsed = {
      records: [
        { timestamp: "2025-06-15T14:30:00Z", heart_rate: 80 }, // no GPS
        { timestamp: "2025-06-15T14:30:01Z", position_lat: 42.5, position_long: -8.6, speed: 5 },
      ],
    };
    const data = fitToParsedData(parsed);
    expect(data.samples.length).toBe(1);
    expect(data.samples[0].speedMps).toBe(5);
  });

  it("throws when there are no GPS records at all", () => {
    const parsed = {
      records: [
        { timestamp: "2025-06-15T14:30:00Z", heart_rate: 80 },
        { timestamp: "2025-06-15T14:30:01Z", heart_rate: 90 },
      ],
    };
    expect(() => fitToParsedData(parsed)).toThrow(/no GPS records/i);
  });

  it("drops duplicate timestamps (a stopped-timer session can emit them)", () => {
    const parsed = {
      records: [
        { timestamp: "2025-06-15T14:30:00Z", position_lat: 42.5, position_long: -8.6, speed: 0 },
        { timestamp: "2025-06-15T14:30:00Z", position_lat: 42.5, position_long: -8.6, speed: 0 }, // dup
        { timestamp: "2025-06-15T14:30:01Z", position_lat: 42.5001, position_long: -8.6, speed: 10 },
      ],
    };
    const data = fitToParsedData(parsed);
    expect(data.samples.length).toBe(2);
    expect(data.samples[1].t).toBe(1000);
  });

  it("only lists fieldMappings for channels that actually appeared", () => {
    const parsed = {
      records: [
        // GPS + speed only.
        { timestamp: "2025-06-15T14:30:00Z", position_lat: 42.5, position_long: -8.6, speed: 10 },
      ],
    };
    const data = fitToParsedData(parsed);
    const names = data.fieldMappings.map((m) => m.name);
    expect(names).toContain("Speed");
    expect(names).not.toContain("Heart Rate");
    expect(names).not.toContain("Power (W)");
  });

  it("carries altitude, cadence, temperature, GPS accuracy when present", () => {
    const parsed = {
      records: [
        {
          timestamp: "2025-06-15T14:30:00Z",
          position_lat: 42.5, position_long: -8.6, speed: 8,
          altitude: 120.5, cadence: 85, temperature: 22, gps_accuracy: 3,
        },
      ],
    };
    const data = fitToParsedData(parsed);
    expect(data.samples[0].extraFields["Altitude (m)"]).toBe(120.5);
    expect(data.samples[0].extraFields["Cadence"]).toBe(85);
    expect(data.samples[0].extraFields["Temp (°C)"]).toBe(22);
    expect(data.samples[0].extraFields["GPS Accuracy (m)"]).toBe(3);
  });
});
