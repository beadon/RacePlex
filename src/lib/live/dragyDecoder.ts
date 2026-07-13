/**
 * Dragy live decoder (issue #32).
 *
 * The Dragy protocol is reverse-engineered — no vendor spec exists publicly.
 * The service, characteristics and handshake come from `jremick/dragy-dash`
 * (MIT). Telemetry is standard UBX **`NAV-PVT`** (class 0x01, id 0x07,
 * 92-byte payload) fragmented across BLE notifications — same UBX ring
 * buffer handles both RaceBox and Dragy on the receive side.
 *
 * The NAV-PVT layout is the u-blox 8 spec (also the shape RaceBox extends).
 * This decoder returns a slimmer sample than the RaceBox one — Dragy doesn't
 * emit g-force or rotation, just position and speed.
 */

import type { UbxPacket } from "./ubxRingBuffer";

export const NAV_PVT_CLASS = 0x01;
export const NAV_PVT_ID = 0x07;
export const NAV_PVT_PAYLOAD_SIZE = 92;

/** Slim sample from a Dragy NAV-PVT packet. Units are canonical (m/s, m, deg). */
export interface DragySample {
  /** Milliseconds of GPS week (`iTOW`). Useful for de-duplication. */
  iTOW: number;
  /** UTC date components (see NAV-PVT bytes 4..10). */
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Nanoseconds correction to the UTC second (signed). */
  nanoseconds: number;
  /** Raw fix type: 0=none, 2=2D, 3=3D. */
  fixType: number;
  /** Flags — bit 0 = fix OK. */
  flags: number;
  /** Convenience — the good-fix test. */
  fixOk: boolean;
  /** Number of SVs used in the fix. */
  numSV: number;
  latitude: number;
  longitude: number;
  altitudeM: number;
  altitudeMslM: number;
  hAccM: number;
  vAccM: number;
  /** Ground speed, m/s (NAV-PVT reports mm/s; converted). */
  speedMps: number;
  /** Heading of motion, degrees (0..360). */
  headingDeg: number;
  /** Speed accuracy, m/s. */
  speedAccMps: number;
  /** Heading accuracy, degrees. */
  headingAccDeg: number;
  /** Position DOP (unitless). */
  pDOP: number;
}

/** Decode a UBX packet as a NAV-PVT sample, or null if it isn't one. */
export function decodeDragyPacket(packet: UbxPacket): DragySample | null {
  if (packet.cls !== NAV_PVT_CLASS) return null;
  if (packet.id !== NAV_PVT_ID) return null;
  if (packet.payload.byteLength !== NAV_PVT_PAYLOAD_SIZE) return null;

  const v = new DataView(
    packet.payload.buffer,
    packet.payload.byteOffset,
    packet.payload.byteLength,
  );

  // NAV-PVT layout (u-blox 8/9 spec):
  //   0  U4  iTOW
  //   4  U2  year
  //   6  U1  month
  //   7  U1  day
  //   8  U1  hour
  //   9  U1  min
  //   10 U1  sec
  //   11 X1  valid flags
  //   12 U4  tAcc
  //   16 I4  nano
  //   20 U1  fixType
  //   21 X1  flags
  //   22 X1  flags2
  //   23 U1  numSV
  //   24 I4  lon (deg × 1e-7)
  //   28 I4  lat (deg × 1e-7)
  //   32 I4  height above ellipsoid (mm)
  //   36 I4  hMSL (mm)
  //   40 U4  hAcc (mm)
  //   44 U4  vAcc (mm)
  //   48 I4  velN (mm/s) — unused (we use gSpeed)
  //   52 I4  velE (mm/s) — unused
  //   56 I4  velD (mm/s) — unused
  //   60 I4  gSpeed (mm/s) — 2D ground speed
  //   64 I4  headMot (deg × 1e-5)
  //   68 U4  sAcc (mm/s)
  //   72 U4  headAcc (deg × 1e-5)
  //   76 U2  pDOP (× 0.01)
  //   78 …  reserved / heading-of-vehicle etc.

  const iTOW = v.getUint32(0, true);
  const year = v.getUint16(4, true);
  const month = v.getUint8(6);
  const day = v.getUint8(7);
  const hour = v.getUint8(8);
  const minute = v.getUint8(9);
  const second = v.getUint8(10);
  const nanoseconds = v.getInt32(16, true);
  const fixType = v.getUint8(20);
  const flags = v.getUint8(21);
  const numSV = v.getUint8(23);
  const longitude1e7 = v.getInt32(24, true);
  const latitude1e7 = v.getInt32(28, true);
  const heightMm = v.getInt32(32, true);
  const hMSLMm = v.getInt32(36, true);
  const hAccMm = v.getUint32(40, true);
  const vAccMm = v.getUint32(44, true);
  const gSpeedMmPerS = v.getInt32(60, true);
  const heading1e5 = v.getInt32(64, true);
  const sAccMmPerS = v.getUint32(68, true);
  const headAcc1e5 = v.getUint32(72, true);
  const pDOP = v.getUint16(76, true) / 100;

  return {
    iTOW,
    year,
    month,
    day,
    hour,
    minute,
    second,
    nanoseconds,
    fixType,
    flags,
    fixOk: fixType === 3 && (flags & 0x01) === 0x01,
    numSV,
    latitude: latitude1e7 / 1e7,
    longitude: longitude1e7 / 1e7,
    altitudeM: heightMm / 1000,
    altitudeMslM: hMSLMm / 1000,
    hAccM: hAccMm / 1000,
    vAccM: vAccMm / 1000,
    speedMps: gSpeedMmPerS / 1000,
    headingDeg: heading1e5 / 1e5,
    speedAccMps: sAccMmPerS / 1000,
    headingAccDeg: headAcc1e5 / 1e5,
    pDOP,
  };
}
