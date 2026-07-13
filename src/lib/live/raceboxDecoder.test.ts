/**
 * RaceBox decoder tests. Payload layout is 80 bytes, LE throughout — the
 * fixture builder here matches the vendor's protocol PDF (Rev 8). Tests are
 * known-answer: we set specific field values, encode a valid UBX packet, run
 * it through the decoder, and assert every field round-trips with the
 * documented scaling.
 */

import { describe, it, expect } from "vitest";
import { UbxRingBuffer } from "./ubxRingBuffer";
import { encodeUbx } from "./__test__/ubxCodec";
import {
  RACEBOX_CLASS,
  RACEBOX_LIVE_ID,
  RACEBOX_RECORDED_ID,
  RACEBOX_PAYLOAD_SIZE,
  decodeRaceBoxPacket,
  raceBoxSampleToDate,
} from "./raceboxDecoder";

/** Build an 80-byte RaceBox payload with sensible defaults + optional overrides. */
function raceboxPayload(overrides: {
  iTOW?: number; year?: number; month?: number; day?: number;
  hour?: number; minute?: number; second?: number; nanoseconds?: number;
  fixStatus?: number; fixStatusFlags?: number; numSV?: number;
  longitude1e7?: number; latitude1e7?: number;
  wgsAltMm?: number; mslAltMm?: number;
  hAccMm?: number; vAccMm?: number;
  speedMmPerS?: number; heading1e5?: number;
  sAccMmPerS?: number; headAcc1e5?: number;
  pDOP100?: number; batteryOrVoltage?: number;
  gForceX?: number; gForceY?: number; gForceZ?: number;
  rotX?: number; rotY?: number; rotZ?: number;
} = {}): Uint8Array {
  const buf = new Uint8Array(RACEBOX_PAYLOAD_SIZE);
  const v = new DataView(buf.buffer);
  v.setUint32(0, overrides.iTOW ?? 0, true);
  v.setUint16(4, overrides.year ?? 2025, true);
  v.setUint8(6, overrides.month ?? 6);
  v.setUint8(7, overrides.day ?? 15);
  v.setUint8(8, overrides.hour ?? 14);
  v.setUint8(9, overrides.minute ?? 30);
  v.setUint8(10, overrides.second ?? 45);
  v.setInt32(16, overrides.nanoseconds ?? 0, true);
  v.setUint8(20, overrides.fixStatus ?? 3);
  v.setUint8(21, overrides.fixStatusFlags ?? 0x01);
  v.setUint8(23, overrides.numSV ?? 12);
  v.setInt32(24, overrides.longitude1e7 ?? 0, true);
  v.setInt32(28, overrides.latitude1e7 ?? 0, true);
  v.setInt32(32, overrides.wgsAltMm ?? 0, true);
  v.setInt32(36, overrides.mslAltMm ?? 0, true);
  v.setUint32(40, overrides.hAccMm ?? 0, true);
  v.setUint32(44, overrides.vAccMm ?? 0, true);
  v.setInt32(48, overrides.speedMmPerS ?? 0, true);
  v.setInt32(52, overrides.heading1e5 ?? 0, true);
  v.setUint32(56, overrides.sAccMmPerS ?? 0, true);
  v.setUint32(60, overrides.headAcc1e5 ?? 0, true);
  v.setUint16(64, overrides.pDOP100 ?? 0, true);
  v.setUint8(67, overrides.batteryOrVoltage ?? 0);
  v.setInt16(68, overrides.gForceX ?? 0, true);
  v.setInt16(70, overrides.gForceY ?? 0, true);
  v.setInt16(72, overrides.gForceZ ?? 0, true);
  v.setInt16(74, overrides.rotX ?? 0, true);
  v.setInt16(76, overrides.rotY ?? 0, true);
  v.setInt16(78, overrides.rotZ ?? 0, true);
  return buf;
}

describe("decodeRaceBoxPacket — known-answer", () => {
  it("decodes a live packet with all documented scaling", () => {
    // A rider doing 108 km/h (30 m/s → 30_000 mm/s), heading north-east at
    // 45°, 100 m altitude, lat/lon a sane pair, decent fix.
    const payload = raceboxPayload({
      latitude1e7: 425_000_000,    // 42.5°
      longitude1e7: -86_000_000,   // -8.6°
      wgsAltMm: 100_000,           // 100 m
      speedMmPerS: 30_000,         // 30 m/s == 108 km/h
      heading1e5: 4_500_000,       // 45°
      gForceX: 1_234,              // 1.234 g longitudinal
      gForceY: -567,               // -0.567 g lateral
      gForceZ: 1_000,              // 1.0 g vertical (upright & stationary in Z)
      rotZ: 2_500,                 // 25.0 deg/s yaw
      pDOP100: 145,                // 1.45
      numSV: 14,
      hAccMm: 2_500,               // 2.5 m
    });
    const packet = { cls: RACEBOX_CLASS, id: RACEBOX_LIVE_ID, payload };
    const s = decodeRaceBoxPacket(packet)!;

    expect(s.latitude).toBeCloseTo(42.5, 7);
    expect(s.longitude).toBeCloseTo(-8.6, 7);
    expect(s.altitudeM).toBe(100);
    expect(s.speedMps).toBe(30);
    expect(s.headingDeg).toBe(45);
    expect(s.gForceXg).toBeCloseTo(1.234, 3);
    expect(s.gForceYg).toBeCloseTo(-0.567, 3);
    expect(s.gForceZg).toBe(1);
    expect(s.rotRateZdps).toBe(25);
    expect(s.pDOP).toBeCloseTo(1.45, 2);
    expect(s.numSV).toBe(14);
    expect(s.hAccM).toBe(2.5);
    expect(s.fixOk).toBe(true);
  });

  it("decodes a recorded packet (id 0x21) using the same 80-byte layout", () => {
    // Vendor doc is explicit: live 0x01 and recorded 0x21 share the payload
    // layout. Nothing in the decoder should care which id it is.
    const payload = raceboxPayload({ speedMmPerS: 15_000, latitude1e7: 400_000_000 });
    const s = decodeRaceBoxPacket({ cls: RACEBOX_CLASS, id: RACEBOX_RECORDED_ID, payload })!;
    expect(s.speedMps).toBe(15);
    expect(s.latitude).toBe(40);
  });

  it("returns null for packets that aren't RaceBox samples", () => {
    const payload = raceboxPayload();
    expect(decodeRaceBoxPacket({ cls: 0x00, id: 0x01, payload })).toBeNull();
    expect(decodeRaceBoxPacket({ cls: RACEBOX_CLASS, id: 0x99, payload })).toBeNull();
    expect(decodeRaceBoxPacket({
      cls: RACEBOX_CLASS, id: RACEBOX_LIVE_ID, payload: new Uint8Array(10),
    })).toBeNull();
  });

  it("marks a poor-fix sample as fixOk=false (bit 0 of fixStatusFlags)", () => {
    const payload = raceboxPayload({ fixStatus: 3, fixStatusFlags: 0x00 });
    const s = decodeRaceBoxPacket({ cls: RACEBOX_CLASS, id: RACEBOX_LIVE_ID, payload })!;
    expect(s.fixOk).toBe(false);
  });

  it("marks a 2D-only sample as fixOk=false (fixStatus < 3)", () => {
    const payload = raceboxPayload({ fixStatus: 2, fixStatusFlags: 0x01 });
    const s = decodeRaceBoxPacket({ cls: RACEBOX_CLASS, id: RACEBOX_LIVE_ID, payload })!;
    expect(s.fixOk).toBe(false);
  });

  it("preserves negative g on the lateral axis (signed 16-bit LE)", () => {
    const payload = raceboxPayload({ gForceY: -1_500 });
    const s = decodeRaceBoxPacket({ cls: RACEBOX_CLASS, id: RACEBOX_LIVE_ID, payload })!;
    expect(s.gForceYg).toBe(-1.5);
  });
});

describe("raceBoxSampleToDate", () => {
  it("folds year/month/day/h/m/s/ns into a UTC Date", () => {
    const payload = raceboxPayload({
      year: 2025, month: 6, day: 15,
      hour: 14, minute: 30, second: 45,
      nanoseconds: 500_000_000, // half a second
    });
    const s = decodeRaceBoxPacket({ cls: RACEBOX_CLASS, id: RACEBOX_LIVE_ID, payload })!;
    const d = raceBoxSampleToDate(s);
    expect(d.toISOString()).toBe("2025-06-15T14:30:45.500Z");
  });
});

describe("end-to-end via UbxRingBuffer", () => {
  it("feeds encoded packets through the ring and out into decoded samples", () => {
    const ring = new UbxRingBuffer();
    const packets = [
      encodeUbx(RACEBOX_CLASS, RACEBOX_LIVE_ID, raceboxPayload({ speedMmPerS: 10_000 })),
      encodeUbx(RACEBOX_CLASS, RACEBOX_LIVE_ID, raceboxPayload({ speedMmPerS: 20_000 })),
      encodeUbx(RACEBOX_CLASS, RACEBOX_LIVE_ID, raceboxPayload({ speedMmPerS: 30_000 })),
    ];
    const combined = new Uint8Array(packets.reduce((s, p) => s + p.byteLength, 0));
    let o = 0;
    for (const p of packets) { combined.set(p, o); o += p.byteLength; }

    // Fragment into 32-byte "notifications" like BLE would.
    const decoded = [];
    for (let i = 0; i < combined.byteLength; i += 32) {
      for (const pkt of ring.push(combined.slice(i, Math.min(i + 32, combined.byteLength)))) {
        const s = decodeRaceBoxPacket(pkt);
        if (s) decoded.push(s);
      }
    }
    expect(decoded.map((s) => s.speedMps)).toEqual([10, 20, 30]);
  });
});
