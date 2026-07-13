/**
 * RaceBox live + recorded packet decoder (issue #32).
 *
 * Per the vendor's own protocol PDF (Rev 8):
 *
 *   - Live data:      class 0xFF, id 0x01, payload 80 bytes.
 *   - Recorded data:  class 0xFF, id 0x21, payload 80 bytes — SAME layout.
 *
 * One decoder therefore serves both live capture and offline download,
 * which is why we split it out from any BLE code.
 *
 * ### Scaling (from the PDF)
 *
 *   - lat/lon   ÷ 1e7      → degrees
 *   - speed     × 1        → mm/s     (divide by 1000 for m/s)
 *   - altitude  × 1        → mm       (divide by 1000 for m)
 *   - heading   ÷ 1e5      → degrees
 *   - g-force   ÷ 1000     → g
 *   - rotation  ÷ 100      → deg/s
 *
 * ### Good-fix test
 *
 *   fixStatus == 3 && (fixStatusFlags & 0x01)
 *
 * This is the reader — pure, no BLE, no I/O. The transport layer feeds
 * complete UBX packets into `decodeRaceBoxPacket`; the app decides what to
 * do with a bad-fix sample (usually: draw it dimmed on the map).
 */

import type { UbxPacket } from './ubxRingBuffer';

export const RACEBOX_CLASS = 0xff;
export const RACEBOX_LIVE_ID = 0x01;
export const RACEBOX_RECORDED_ID = 0x21;

/** Payload byte count for live + recorded packets. Both are 80 bytes. */
export const RACEBOX_PAYLOAD_SIZE = 80;

/** One RaceBox sample, in canonical units (m/s, m, deg, g). */
export interface RaceBoxSample {
  /** Milliseconds of GPS week (`iTOW`). Useful for de-duplication. */
  iTOW: number;
  /** UTC year (e.g. 2025). */
  year: number;
  /** UTC month (1..12). */
  month: number;
  /** UTC day (1..31). */
  day: number;
  /** UTC hour (0..23). */
  hour: number;
  /** UTC minute (0..59). */
  minute: number;
  /** UTC second (0..60 — leap-second-tolerant). */
  second: number;
  /** Nanoseconds part of the UTC second (-1e9 .. 1e9). */
  nanoseconds: number;
  /** Raw fix status: 0=no fix, 2=2D, 3=3D. */
  fixStatus: number;
  /** Raw fix-status flags — bit 0 = fix OK (gnssFixOK). */
  fixStatusFlags: number;
  /** Convenience — the good-fix test recommended by the vendor. */
  fixOk: boolean;
  /** Number of SVs used in the fix. */
  numSV: number;
  /** Degrees. */
  latitude: number;
  /** Degrees. */
  longitude: number;
  /** Metres above WGS-84. */
  altitudeM: number;
  /** Metres above MSL. */
  altitudeMslM: number;
  /** Horizontal accuracy in metres. */
  hAccM: number;
  /** Vertical accuracy in metres. */
  vAccM: number;
  /** Ground speed, metres per second. */
  speedMps: number;
  /** Heading of motion, degrees (0..360). */
  headingDeg: number;
  /** Speed accuracy, metres per second. */
  speedAccMps: number;
  /** Heading accuracy, degrees. */
  headingAccDeg: number;
  /** Position DOP (unitless). */
  pDOP: number;
  /** Battery status (% for RaceBox Mini, voltage/16 for the Micro). */
  batteryOrVoltage: number;
  /** Longitudinal g (forward positive). */
  gForceXg: number;
  /** Lateral g (right positive). */
  gForceYg: number;
  /** Vertical g (down positive). */
  gForceZg: number;
  /** Roll rate, deg/s. */
  rotRateXdps: number;
  /** Pitch rate, deg/s. */
  rotRateYdps: number;
  /** Yaw rate, deg/s. */
  rotRateZdps: number;
}

/**
 * Decode a UBX packet as a RaceBox live or recorded sample. Returns null when
 * the packet isn't ours (wrong class/id or wrong payload size) — the caller
 * loops over every packet the ring buffer produced and drops the nulls.
 *
 * The layout is identical for live (0x01) and recorded (0x21); a caller that
 * wants to distinguish should look at `packet.id` before calling this.
 */
export function decodeRaceBoxPacket(packet: UbxPacket): RaceBoxSample | null {
  if (packet.cls !== RACEBOX_CLASS) return null;
  if (packet.id !== RACEBOX_LIVE_ID && packet.id !== RACEBOX_RECORDED_ID) return null;
  if (packet.payload.byteLength !== RACEBOX_PAYLOAD_SIZE) return null;

  // A DataView is the safe way to read little-endian multi-byte fields.
  // The RaceBox payload is defined as LE across the board (docs are explicit).
  const v = new DataView(
    packet.payload.buffer,
    packet.payload.byteOffset,
    packet.payload.byteLength,
  );

  const iTOW = v.getUint32(0, true);
  const year = v.getUint16(4, true);
  const month = v.getUint8(6);
  const day = v.getUint8(7);
  const hour = v.getUint8(8);
  const minute = v.getUint8(9);
  const second = v.getUint8(10);
  // byte 11 is `validityFlags` — we don't use it directly, the good-fix
  // condition below is sufficient for the app.
  const timeAcc = v.getUint32(12, true); // ns — unused here
  void timeAcc;
  const nanoseconds = v.getInt32(16, true);
  const fixStatus = v.getUint8(20);
  const fixStatusFlags = v.getUint8(21);
  // byte 22 = dateTimeFlags, byte 23 = numSV.
  const numSV = v.getUint8(23);

  const longitude1e7 = v.getInt32(24, true);
  const latitude1e7 = v.getInt32(28, true);
  const wgsAltMm = v.getInt32(32, true);
  const mslAltMm = v.getInt32(36, true);
  const hAccMm = v.getUint32(40, true);
  const vAccMm = v.getUint32(44, true);
  const speedMmPerS = v.getInt32(48, true);
  const heading1e5 = v.getInt32(52, true);
  const sAccMmPerS = v.getUint32(56, true);
  const headAcc1e5 = v.getUint32(60, true);
  const pDOP = v.getUint16(64, true) / 100;
  // bytes 66..68 reserved
  const batteryOrVoltage = v.getUint8(67);
  const gForceX = v.getInt16(68, true);
  const gForceY = v.getInt16(70, true);
  const gForceZ = v.getInt16(72, true);
  const rotX = v.getInt16(74, true);
  const rotY = v.getInt16(76, true);
  const rotZ = v.getInt16(78, true);

  return {
    iTOW,
    year,
    month,
    day,
    hour,
    minute,
    second,
    nanoseconds,
    fixStatus,
    fixStatusFlags,
    fixOk: fixStatus === 3 && (fixStatusFlags & 0x01) === 0x01,
    numSV,
    latitude: latitude1e7 / 1e7,
    longitude: longitude1e7 / 1e7,
    altitudeM: wgsAltMm / 1000,
    altitudeMslM: mslAltMm / 1000,
    hAccM: hAccMm / 1000,
    vAccM: vAccMm / 1000,
    speedMps: speedMmPerS / 1000,
    headingDeg: heading1e5 / 1e5,
    speedAccMps: sAccMmPerS / 1000,
    headingAccDeg: headAcc1e5 / 1e5,
    pDOP,
    batteryOrVoltage,
    gForceXg: gForceX / 1000,
    gForceYg: gForceY / 1000,
    gForceZg: gForceZ / 1000,
    rotRateXdps: rotX / 100,
    rotRateYdps: rotY / 100,
    rotRateZdps: rotZ / 100,
  };
}

/**
 * Convert a decoded RaceBox sample's UTC fields into a JS Date. Nanoseconds
 * are folded into the milliseconds argument (any sub-ms precision is lost —
 * `Date` doesn't do better).
 */
export function raceBoxSampleToDate(sample: RaceBoxSample): Date {
  return new Date(Date.UTC(
    sample.year,
    sample.month - 1,
    sample.day,
    sample.hour,
    sample.minute,
    sample.second,
    Math.round(sample.nanoseconds / 1_000_000),
  ));
}
