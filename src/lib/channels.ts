// Canonical telemetry channel registry — the single source of truth for channel
// identity across every parser and consumer.
//
// Problem this solves: each parser used to emit its own display-name keys into
// `GpsSample.extraFields` ("Lat G", "RPM", "Accel X", "Water Temp"…). Those keys
// doubled as the field's identity everywhere — chart toggles, settings
// field-default hide/show, stored graph-prefs, saved video-overlay configs — so
// "hide RPM by default" only matched the one parser whose spelling you'd seen.
//
// Here we define a stable `ChannelId` per physical quantity. Parsers resolve the
// raw log/column name to a `ChannelId` and key `extraFields` by it; the UI reads
// `label`/`unit` for display. A default like "hide RPM" then applies regardless
// of which logger produced the file.
//
// G-force note: lateral/longitudinal g is modelled as DISTINCT ids per source —
// `lat_g`/`lon_g` (primary; GPS-derived when computed), `lat_g_native`/
// `lon_g_native` (logger-reported native g), and `accel_x/y/z` (raw body-frame
// IMU). These legitimately coexist on one sample (e.g. Alfano reports native g
// while we also derive g from GPS), so they must never collapse to one key.

export type ChannelId =
  // GPS / quality
  | "altitude"
  | "satellites"
  | "hdop"
  | "h_acc"
  // G-force / IMU
  | "lat_g"
  | "lon_g"
  | "lat_g_native"
  | "lon_g_native"
  | "accel_x"
  | "accel_y"
  | "accel_z"
  | "yaw_rate"
  // Engine / sensors
  | "rpm"
  | "water_temp"
  | "oil_temp"
  | "egt"
  | "temp_1"
  | "temp_2"
  | "throttle"
  | "brake"
  // Derived
  | "distance";

export interface ChannelDef {
  id: ChannelId;
  /** Human-readable label for UI display. */
  label: string;
  /** Display unit, when one is well-defined. */
  unit?: string;
  /**
   * Raw field/column names (across loggers and older parsers) that resolve to
   * this id. Matched case-insensitively. The canonical `label` need not be
   * repeated here — it is matched implicitly (see `resolveChannelId`).
   */
  aliases: string[];
}

// Order is the canonical display/registration order.
export const CHANNELS: readonly ChannelDef[] = [
  { id: "altitude", label: "Altitude", unit: "m", aliases: ["Altitude (m)", "Alt", "Altitude M"] },
  { id: "satellites", label: "Satellites", aliases: ["Sats", "NumSats"] },
  { id: "hdop", label: "HDOP", aliases: ["Hdop"] },
  { id: "h_acc", label: "H Accuracy", unit: "m", aliases: ["H Acc M", "Horizontal Accuracy"] },

  { id: "lat_g", label: "Lat G", unit: "g", aliases: ["Lateral G", "LatG"] },
  { id: "lon_g", label: "Lon G", unit: "g", aliases: ["Longitudinal G", "LonG"] },
  { id: "lat_g_native", label: "Lat G (Native)", unit: "g", aliases: [] },
  { id: "lon_g_native", label: "Lon G (Native)", unit: "g", aliases: [] },
  { id: "accel_x", label: "Accel X", aliases: [] },
  { id: "accel_y", label: "Accel Y", aliases: [] },
  { id: "accel_z", label: "Accel Z", aliases: [] },
  { id: "yaw_rate", label: "Yaw Rate", unit: "°/s", aliases: [] },

  { id: "rpm", label: "RPM", aliases: ["Rpm", "Engine RPM", "Engine_RPM"] },
  { id: "water_temp", label: "Water Temp", unit: "°C", aliases: ["Water Temperature", "Coolant Temp"] },
  { id: "oil_temp", label: "Oil Temp", unit: "°C", aliases: ["Oil Temperature"] },
  { id: "egt", label: "EGT", unit: "°C", aliases: ["Exhaust Temp", "Exhaust Gas Temp"] },
  { id: "temp_1", label: "Temp 1", unit: "°C", aliases: [] },
  { id: "temp_2", label: "Temp 2", unit: "°C", aliases: [] },
  { id: "throttle", label: "Throttle", unit: "%", aliases: ["TPS", "Throttle Position"] },
  { id: "brake", label: "Brake", aliases: ["Brake Pressure"] },

  { id: "distance", label: "Distance", unit: "m", aliases: [] },
] as const;

const byId = new Map<ChannelId, ChannelDef>(CHANNELS.map((c) => [c.id, c]));

// Reverse lookup: lowercased raw name -> id. Both the canonical `label` and every
// alias resolve. A later registration never overwrites an earlier one, so the
// table is deterministic regardless of insertion quirks.
const nameToId = new Map<string, ChannelId>();
for (const def of CHANNELS) {
  for (const name of [def.label, ...def.aliases]) {
    const key = name.toLowerCase();
    if (!nameToId.has(key)) nameToId.set(key, def.id);
  }
}

/** Resolve a raw log/column/display name to a `ChannelId`, or undefined if unknown. */
export function resolveChannelId(rawName: string): ChannelId | undefined {
  return nameToId.get(rawName.trim().toLowerCase());
}

/** The definition for a known id. */
export function getChannelDef(id: ChannelId): ChannelDef | undefined {
  return byId.get(id);
}

/** Display label for an id (falls back to the id itself if somehow unknown). */
export function channelLabel(id: ChannelId): string {
  return byId.get(id)?.label ?? id;
}

/** Display unit for an id, or undefined when none is well-defined. */
export function channelUnit(id: ChannelId): string | undefined {
  return byId.get(id)?.unit;
}

export function isKnownChannel(id: string): id is ChannelId {
  return byId.has(id as ChannelId);
}

/**
 * Stable key for a channel with no canonical mapping (a custom logger column).
 * Slugged so the same raw column always yields the same key — `custom:` prefixed
 * so it can never collide with a canonical id. Consumers display the original
 * name via the field's label, not this key.
 */
export function customChannelId(rawName: string): string {
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `custom:${slug || "field"}`;
}

/**
 * Resolve a raw name to its stable storage key: a `ChannelId` when known, else a
 * `custom:`-prefixed slug. This is the identity parsers write into `extraFields`
 * and that settings/graph-prefs/overlays key off.
 */
export function channelKeyFor(rawName: string): string {
  return resolveChannelId(rawName) ?? customChannelId(rawName);
}
