// Pure mapping: libxrk's raw channel arrays -> the app's `ParsedData`.
//
// Kept free of Pyodide/worker concerns so it is fully unit-testable with
// synthetic channel data. The output uses the app's human display names (e.g.
// "Lat G", "RPM") exactly like every other parser; `normalizeChannels()` (run by
// the format router) then canonicalises them to channel ids. GPS
// Latitude/Longitude/Speed/Heading are folded into the `GpsSample` primaries;
// everything else lands in `extraFields`.

import { ParsedData, GpsSample, FieldMapping } from "@/types/racing";
import { applyGForceCalculations } from "../gforceCalculation";
import {
  speedTriple,
  calculateBounds,
  validateGpsCoords,
  KPH_TO_MPS,
  MPH_TO_MPS,
} from "../parserUtils";
import type { XrkRawResult } from "./xrkTypes";

/** Normalise an AiM channel name for tolerant matching (case/space/underscore). */
function norm(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

/** Roles for the four channels that feed the GpsSample primaries. */
type GpsRole = "lat" | "lon" | "speed" | "heading";

const GPS_ROLES: Record<string, GpsRole> = {
  "gps latitude": "lat",
  "gps longitude": "lon",
  "gps speed": "speed",
  "gps heading": "heading",
};

/**
 * libxrk channel name -> the app's human display label. Covers the common,
 * unambiguous channels; anything not listed passes through under its own AiM
 * name (becoming a `custom:` channel that still displays with its label + unit).
 *
 * G-force convention (see channels.ts): GPS-derived lateral/inline accel is the
 * primary ("Lat G"/"Lon G"); the IMU-native accel is the "(Native)" variant.
 */
const CHANNEL_LABELS: Record<string, string> = {
  "gps altitude": "Altitude",
  "gps satellites": "Satellites",
  "gps nsat": "Satellites",
  "gps lateralacc": "Lateral G",
  "gps lat acc": "Lateral G",
  "gps latacc": "Lateral G",
  "gps inlineacc": "Longitudinal G",
  "gps lonacc": "Longitudinal G",
  "gps yaw rate": "Yaw Rate",
  // IMU body-frame accel (raw, not grip-frame aligned) -> canonical accel_*.
  accelerometerx: "Accel X",
  accelerometery: "Accel Y",
  accelerometerz: "Accel Z",
  lateralacc: "Lat G (Native)",
  inlineacc: "Lon G (Native)",
  yawrate: "Yaw Rate",
  rpm: "RPM",
  "engine rpm": "RPM",
  wt: "Water Temp",
  "water temp": "Water Temp",
  ot: "Oil Temp",
  "oil temp": "Oil Temp",
  egt: "EGT",
  tps: "Throttle",
  throttle: "Throttle",
  "temperature 1": "Temp 1",
  "temperature 2": "Temp 2",
};

/** Convert a libxrk GPS-speed value (per its unit) to m/s. AiM default is km/h. */
function speedToMps(value: number, unit: string): number {
  const u = unit.toLowerCase().replace(/\s+/g, "");
  if (u === "m/s" || u === "mps") return value;
  if (u === "mph") return value * MPH_TO_MPS;
  // "km/h", "kmh", "kph", or unknown -> assume km/h (AiM's default GPS speed unit).
  return value * KPH_TO_MPS;
}

/** Display label for a passed-through (non-curated) channel. */
function passthroughLabel(name: string): string {
  return CHANNEL_LABELS[norm(name)] ?? name;
}

/**
 * Map a parsed XRK session into the app's normalized-shape `ParsedData`. Returns
 * human-named fields (canonicalised later by `normalizeChannels`).
 */
export function mapXrkToParsedData(raw: XrkRawResult, _fileName: string): ParsedData {
  const { timecodes, channels } = raw;
  const sampleCount = timecodes.length;
  if (sampleCount === 0) {
    throw new Error("XRK file contains no samples");
  }

  // Resolve the GPS primaries up front.
  const gps: Partial<Record<GpsRole, { values: Float64Array; unit: string }>> = {};
  const extras: { label: string; unit: string; values: Float64Array }[] = [];

  for (const ch of channels) {
    const role = GPS_ROLES[norm(ch.name)];
    if (role && !gps[role]) {
      gps[role] = { values: ch.values, unit: ch.unit };
    } else {
      extras.push({ label: passthroughLabel(ch.name), unit: ch.unit, values: ch.values });
    }
  }

  if (!gps.lat || !gps.lon) {
    throw new Error("XRK file is missing GPS Latitude/Longitude channels");
  }

  const t0 = timecodes[0];
  const samples: GpsSample[] = [];
  // Per-extra unit, captured once for the field mappings (first non-trivial unit wins).
  const extraUnits = new Map<string, string>();

  for (let i = 0; i < sampleCount; i++) {
    const lat = gps.lat.values[i];
    const lon = gps.lon.values[i];
    // Drop rows without a usable GPS fix (same contract as the other parsers).
    if (validateGpsCoords(lat, lon) !== null) continue;

    const speedMps = gps.speed ? speedToMps(gps.speed.values[i], gps.speed.unit) : 0;
    const heading = gps.heading ? gps.heading.values[i] : undefined;

    const extraFields: Record<string, number> = {};
    for (const ex of extras) {
      const v = ex.values[i];
      if (Number.isFinite(v)) {
        extraFields[ex.label] = v;
        if (ex.unit && !extraUnits.has(ex.label)) extraUnits.set(ex.label, ex.unit);
      }
    }

    samples.push({
      t: timecodes[i] - t0,
      lat,
      lon,
      ...speedTriple(speedMps),
      heading: heading !== undefined && Number.isFinite(heading) ? heading : undefined,
      extraFields,
    });
  }

  if (samples.length === 0) {
    throw new Error("XRK file contains no valid GPS samples");
  }

  // Derive lateral/longitudinal G from GPS when the log carries neither a
  // GPS-derived nor native g pair — mirrors the CSV AiM parser.
  const hasLatG = samples.some(
    (s) => "Lat G" in s.extraFields || "Lateral G" in s.extraFields || "Lat G (Native)" in s.extraFields,
  );
  const hasLonG = samples.some(
    (s) => "Lon G" in s.extraFields || "Longitudinal G" in s.extraFields || "Lon G (Native)" in s.extraFields,
  );
  if (!hasLatG || !hasLonG) {
    applyGForceCalculations(samples, 5);
  }

  // Build field mappings from whatever extraFields ended up present.
  const fieldNames = new Set<string>();
  samples.forEach((s) => Object.keys(s.extraFields).forEach((k) => fieldNames.add(k)));
  const fieldMappings: FieldMapping[] = Array.from(fieldNames).map((name, index) => ({
    index,
    name,
    unit: extraUnits.get(name),
    enabled: true,
  }));

  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate: parseXrkStartDate(raw.metadata),
  };
}

/**
 * Best-effort wall-clock start time from libxrk metadata. AiM exposes the log
 * date/time under a few possible keys; an unparseable value just yields
 * undefined (the app falls back to the first sample for browser display names).
 */
export function parseXrkStartDate(metadata: Record<string, string | number>): Date | undefined {
  const candidates = [
    metadata["Log Date"],
    metadata["Log Time"],
    metadata["Date"],
    metadata["Time"],
    metadata["datetime"],
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      // Epoch seconds vs milliseconds heuristic.
      const ms = c > 1e12 ? c : c * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof c === "string") {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return undefined;
}
