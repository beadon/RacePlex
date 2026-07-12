// GPMF streams -> ParsedData. Pure: no libraries, no I/O, fully unit-testable
// against the vendored `.raw` fixtures.

import type { FieldMapping, GpsSample, ParsedData } from "@/types/racing";
import {
  STANDARD_GRAVITY_MPS2,
  calculateBounds,
  speedTriple,
  validateGpsCoords,
} from "../parserUtils";
import type { GpmfDevice, GpmfDevices, GpmfSample, GpmfStream } from "./gpmfTypes";

/**
 * GoPro's two GPS streams, most-capable first.
 *
 * GPS5 (HERO5–HERO10, ~18 Hz): [lat°, lon°, altitude m, 2D speed m/s, 3D speed m/s].
 * GPS9 (HERO11+, ~10 Hz): the same five, then [days, secs, DOP, fix] — per-sample
 * fix quality and time, which GPS5 only carries as a sticky value.
 *
 * The units are NOT assumed: `gopro-telemetry` reports them on the stream
 * (`units: ["deg","deg","m","m/s","m/s"]`) and the fixture tests assert the speed
 * column really is m/s by cross-checking it against haversine distance over time.
 */
const GPS_STREAMS = ["GPS9", "GPS5"] as const;

// Shared value indices (GPS9 is a superset of GPS5).
const LAT = 0;
const LON = 1;
const ALTITUDE_M = 2;
const SPEED_2D_MPS = 3;
/** GPS9 only: dilution of precision, and lock type (0 none / 2 = 2D / 3 = 3D). */
const GPS9_DOP = 7;
const GPS9_FIX = 8;

/** A GPS5 sticky `precision` is DOP × 100. */
const GPS5_PRECISION_SCALE = 100;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * GoPro's IMU axis order, straight from the GPMF stream names:
 *   ACCL = (up/down, right/left, forward/back), m/s²
 *   GYRO = (z, x, y), rad/s
 *
 * We publish them on the app's body-frame convention — x lateral, y
 * longitudinal, z vertical — and in G, because `chartUtils.G_FORCE_FIELDS_HW`
 * reads `accel_x`/`accel_y` as the hardware lat/lon g-force pair.
 */
const ACCL_UP = 0;
const ACCL_RIGHT = 1;
const ACCL_FORWARD = 2;
/** GYRO's first component is rotation about the vertical axis, i.e. yaw rate. */
const GYRO_YAW = 0;

export class NoGoProGpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoGoProGpsError";
  }
}

/**
 * The error a rider is overwhelmingly likely to hit, so it has to explain itself.
 * A GoPro video with no GPMF GPS stream is almost always one of three things.
 */
const NO_GPS_MESSAGE =
  "No GPS data in this video. The HERO12 has no GPS receiver at all; " +
  "on older HERO cameras GPS must be switched on in Preferences > Regional > GPS " +
  "before recording, and the camera needs a lock before you hit record.";

function toArray(value: number[] | number): number[] {
  return Array.isArray(value) ? value : [value];
}

/** First device that actually carries a GPS stream (usually "1"). */
function findGpsDevice(
  devices: GpmfDevices,
): { device: GpmfDevice; gps: GpmfStream; streamKey: string } | null {
  for (const device of Object.values(devices)) {
    if (!device?.streams) continue;
    for (const streamKey of GPS_STREAMS) {
      const gps = device.streams[streamKey];
      if (gps?.samples?.length) return { device, gps, streamKey };
    }
  }
  return null;
}

/**
 * Nearest-sample lookup onto the GPS timebase.
 *
 * The IMU runs ~200 Hz against GPS's 10–18 Hz, so every GPS sample has an
 * accelerometer reading within a few milliseconds of it. Nearest-neighbour is
 * both correct enough and cheap — a single forward walk, since both streams are
 * already sorted by `cts`.
 */
function nearestByCts(source: GpmfSample[], targets: number[]): (GpmfSample | undefined)[] {
  const out: (GpmfSample | undefined)[] = new Array(targets.length).fill(undefined);
  if (source.length === 0) return out;

  let i = 0;
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    while (i < source.length - 1 && Math.abs(source[i + 1].cts - t) <= Math.abs(source[i].cts - t)) {
      i++;
    }
    out[k] = source[i];
  }
  return out;
}

/**
 * Map decoded GPMF streams into the app's `ParsedData`.
 *
 * @throws {NoGoProGpsError} when the video carries no usable GPS — the common
 * case, and the one that needs a human-readable explanation rather than a crash.
 */
export function mapGpmfToParsedData(devices: GpmfDevices): ParsedData {
  const found = findGpsDevice(devices);
  if (!found) throw new NoGoProGpsError(NO_GPS_MESSAGE);

  const { device, gps, streamKey } = found;
  const isGps9 = streamKey === "GPS9";

  // Keep only fixes we can actually plot. A camera records from the moment you
  // hit the button, so the head of the stream is often (0, 0) or a no-lock fix.
  const fixes = gps.samples.filter((s) => {
    const v = toArray(s.value);
    if (validateGpsCoords(v[LAT], v[LON]) !== null) return false;
    // Lock type: per-sample on GPS9, an inlined sticky on GPS5. 0 = no fix, no
    // matter what coordinates the camera printed next to it.
    const lock = isGps9 ? v[GPS9_FIX] : stickyNumber(s, "fix");
    if (lock === 0) return false;
    return true;
  });

  if (fixes.length === 0) {
    throw new NoGoProGpsError(
      `This video has a ${streamKey} stream but no valid GPS fixes in it — ` +
        "the camera never got a lock. " +
        NO_GPS_MESSAGE,
    );
  }

  const streams = device.streams ?? {};
  const ctsList = fixes.map((s) => s.cts);
  const accl = nearestByCts(streams.ACCL?.samples ?? [], ctsList);
  const gyro = nearestByCts(streams.GYRO?.samples ?? [], ctsList);

  // `cts` is relative to the first VIDEO frame; GPS starts whenever it got a lock.
  // Rebase onto the first fix so `t` is "ms since the first sample", as every
  // other parser here means it.
  const baseCts = fixes[0].cts;

  const samples: GpsSample[] = [];
  let hasAltitude = false;
  let hasHdop = false;
  let hasAccel = false;
  let hasGyro = false;
  let lastT = -Infinity;

  fixes.forEach((fix, i) => {
    const t = fix.cts - baseCts;
    // GPMF timing is derived from the MP4 sample table and is normally strictly
    // increasing; a chapter-joined or repaired file can still hand us a step
    // backwards, which would fold the lap timeline over on itself. Drop those.
    if (!(t > lastT) && samples.length > 0) return;
    lastT = t;

    const v = toArray(fix.value);
    const extraFields: Record<string, number> = {};

    const altitude = v[ALTITUDE_M];
    if (Number.isFinite(altitude)) {
      extraFields["Altitude (m)"] = altitude;
      hasAltitude = true;
    }

    // Dilution of precision: per-sample on GPS9, a sticky (×100) on GPS5.
    const dop = isGps9 ? v[GPS9_DOP] : stickyNumber(fix, "precision") / GPS5_PRECISION_SCALE;
    if (Number.isFinite(dop) && dop > 0) {
      extraFields["HDOP"] = dop;
      hasHdop = true;
    }

    const a = accl[i] ? toArray(accl[i]!.value) : undefined;
    if (a && a.length >= 3) {
      extraFields["Accel X"] = a[ACCL_RIGHT] / STANDARD_GRAVITY_MPS2;
      extraFields["Accel Y"] = a[ACCL_FORWARD] / STANDARD_GRAVITY_MPS2;
      extraFields["Accel Z"] = a[ACCL_UP] / STANDARD_GRAVITY_MPS2;
      hasAccel = true;
    }

    const g = gyro[i] ? toArray(gyro[i]!.value) : undefined;
    if (g && g.length >= 3) {
      extraFields["Yaw Rate"] = g[GYRO_YAW] * RAD_TO_DEG;
      hasGyro = true;
    }

    // 2D (ground) speed, in m/s — that's what a lap time is made of. The 3D speed
    // in v[4] includes the vertical component and is not what we want here.
    const speedMps = Number.isFinite(v[SPEED_2D_MPS]) ? v[SPEED_2D_MPS] : 0;

    samples.push({
      t,
      lat: v[LAT],
      lon: v[LON],
      ...speedTriple(speedMps),
      extraFields,
    });
  });

  const fieldMappings: FieldMapping[] = [{ index: -1, name: "Speed", enabled: true }];
  if (hasAltitude) fieldMappings.push({ index: -2, name: "Altitude (m)", enabled: true });
  if (hasHdop) fieldMappings.push({ index: -3, name: "HDOP", enabled: true });
  if (hasAccel) {
    fieldMappings.push(
      { index: -4, name: "Accel X", enabled: true },
      { index: -5, name: "Accel Y", enabled: true },
      { index: -6, name: "Accel Z", enabled: true },
    );
  }
  if (hasGyro) fieldMappings.push({ index: -7, name: "Yaw Rate", enabled: true });

  // GPMF carries the GPS UTC fix time alongside the video-relative one. Use it,
  // so the session lands on the right day/time in the file browser.
  const startDate = parseGpmfDate(fixes[0].date);

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    ...(startDate ? { startDate } : {}),
  };
}

/**
 * `gopro-telemetry` returns `date` as a `Date`, but its own docs describe it as a
 * timestamp and older versions stringified it. Handle both — and never round-trip
 * a `Date` through `Date.parse`, which drops the milliseconds.
 */
function parseGpmfDate(date: string | Date | undefined): Date | undefined {
  if (date instanceof Date) return Number.isFinite(date.getTime()) ? date : undefined;
  if (typeof date !== "string") return undefined;
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

/**
 * Read a GPMF "sticky" value (one the camera only writes when it changes). We
 * decode with `repeatSticky`, which inlines them onto every sample; fall back to
 * the nested `sticky` object so the mapper still works on raw-shaped input.
 */
function stickyNumber(sample: GpmfSample, key: "fix" | "precision"): number {
  const inlined = sample[key];
  if (typeof inlined === "number") return inlined;
  const nested = sample.sticky?.[key];
  return typeof nested === "number" ? nested : NaN;
}
