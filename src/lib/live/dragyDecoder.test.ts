import { describe, it, expect } from "vitest";
import { UbxRingBuffer } from "./ubxRingBuffer";
import { encodeUbx } from "./__test__/ubxCodec";
import {
  NAV_PVT_CLASS,
  NAV_PVT_ID,
  NAV_PVT_PAYLOAD_SIZE,
  decodeDragyPacket,
} from "./dragyDecoder";
import { dragyHandshakeReply } from "./dragyHandshake";

function navPvtPayload(overrides: {
  latitude1e7?: number; longitude1e7?: number;
  heightMm?: number; gSpeedMmPerS?: number; heading1e5?: number;
  fixType?: number; flags?: number; numSV?: number; pDOP100?: number;
} = {}): Uint8Array {
  const buf = new Uint8Array(NAV_PVT_PAYLOAD_SIZE);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0, true);          // iTOW
  v.setUint16(4, 2025, true);
  v.setUint8(6, 6); v.setUint8(7, 15);
  v.setUint8(8, 14); v.setUint8(9, 30); v.setUint8(10, 0);
  v.setUint8(20, overrides.fixType ?? 3);
  v.setUint8(21, overrides.flags ?? 0x01);
  v.setUint8(23, overrides.numSV ?? 12);
  v.setInt32(24, overrides.longitude1e7 ?? 0, true);
  v.setInt32(28, overrides.latitude1e7 ?? 0, true);
  v.setInt32(32, overrides.heightMm ?? 0, true);
  v.setInt32(60, overrides.gSpeedMmPerS ?? 0, true);
  v.setInt32(64, overrides.heading1e5 ?? 0, true);
  v.setUint16(76, overrides.pDOP100 ?? 100, true);
  return buf;
}

describe("decodeDragyPacket", () => {
  it("decodes a NAV-PVT sample with the documented scaling", () => {
    const payload = navPvtPayload({
      latitude1e7: 425_000_000,
      longitude1e7: -86_000_000,
      heightMm: 100_000,
      gSpeedMmPerS: 30_000,
      heading1e5: 4_500_000,
      pDOP100: 145,
    });
    const s = decodeDragyPacket({ cls: NAV_PVT_CLASS, id: NAV_PVT_ID, payload })!;
    expect(s.latitude).toBeCloseTo(42.5, 7);
    expect(s.longitude).toBeCloseTo(-8.6, 7);
    expect(s.altitudeM).toBe(100);
    expect(s.speedMps).toBe(30);
    expect(s.headingDeg).toBe(45);
    expect(s.pDOP).toBeCloseTo(1.45, 2);
    expect(s.fixOk).toBe(true);
  });

  it("returns null for wrong class/id/size", () => {
    const payload = navPvtPayload();
    expect(decodeDragyPacket({ cls: 0xff, id: NAV_PVT_ID, payload })).toBeNull();
    expect(decodeDragyPacket({ cls: NAV_PVT_CLASS, id: 0x01, payload })).toBeNull();
    expect(decodeDragyPacket({
      cls: NAV_PVT_CLASS, id: NAV_PVT_ID, payload: new Uint8Array(10),
    })).toBeNull();
  });

  it("marks a 2D fix as fixOk=false", () => {
    const payload = navPvtPayload({ fixType: 2, flags: 0x01 });
    const s = decodeDragyPacket({ cls: NAV_PVT_CLASS, id: NAV_PVT_ID, payload })!;
    expect(s.fixOk).toBe(false);
  });

  it("marks a poor-fix sample (bit 0 unset) as fixOk=false", () => {
    const payload = navPvtPayload({ fixType: 3, flags: 0x00 });
    const s = decodeDragyPacket({ cls: NAV_PVT_CLASS, id: NAV_PVT_ID, payload })!;
    expect(s.fixOk).toBe(false);
  });

  it("stitches fragmented NAV-PVT packets end-to-end via UbxRingBuffer", () => {
    const ring = new UbxRingBuffer();
    const p = encodeUbx(NAV_PVT_CLASS, NAV_PVT_ID, navPvtPayload({ gSpeedMmPerS: 20_000 }));
    // Split at three arbitrary boundaries — same shape as a real BLE stream.
    const decoded = [];
    for (const chunk of [p.slice(0, 5), p.slice(5, 50), p.slice(50)]) {
      for (const packet of ring.push(chunk)) {
        const s = decodeDragyPacket(packet);
        if (s) decoded.push(s);
      }
    }
    expect(decoded).toHaveLength(1);
    expect(decoded[0].speedMps).toBe(20);
  });
});

describe("dragyHandshakeReply", () => {
  it("computes [a, b, a^b, a&b] from the 2-byte challenge", () => {
    // From the dragy-dash source: XOR and AND masks over the two challenge
    // bytes. Trivial to test — no crypto, just bitwise.
    const reply = dragyHandshakeReply(new Uint8Array([0x5a, 0xa5]));
    expect(Array.from(reply)).toEqual([0x5a, 0xa5, 0x5a ^ 0xa5, 0x5a & 0xa5]);
  });

  it("throws on a short challenge", () => {
    expect(() => dragyHandshakeReply(new Uint8Array([0x01]))).toThrow(/2-byte/);
  });
});
