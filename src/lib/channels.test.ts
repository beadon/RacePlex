import { describe, it, expect } from "vitest";
import {
  CHANNELS,
  channelKeyFor,
  channelLabel,
  channelUnit,
  customChannelId,
  isKnownChannel,
  resolveChannelId,
} from "./channels";

describe("channel registry", () => {
  it("has unique ids", () => {
    const ids = CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a canonical label to its id (case-insensitive, trimmed)", () => {
    expect(resolveChannelId("RPM")).toBe("rpm");
    expect(resolveChannelId("  rpm  ")).toBe("rpm");
    expect(resolveChannelId("Water Temp")).toBe("water_temp");
  });

  it("resolves known aliases to the canonical id", () => {
    expect(resolveChannelId("Lateral G")).toBe("lat_g");
    expect(resolveChannelId("Engine RPM")).toBe("rpm");
    expect(resolveChannelId("Altitude (m)")).toBe("altitude");
    expect(resolveChannelId("H Acc M")).toBe("h_acc");
  });

  it("keeps measured, native, and raw-IMU g as distinct ids (never collapses)", () => {
    expect(resolveChannelId("Lat G")).toBe("lat_g");
    expect(resolveChannelId("Lat G (Native)")).toBe("lat_g_native");
    expect(resolveChannelId("Accel X")).toBe("accel_x");
    // The three are genuinely different channels that can coexist on one sample.
    const ids = new Set(["lat_g", "lat_g_native", "accel_x"]);
    expect(ids.size).toBe(3);
  });

  it("returns undefined for an unknown name", () => {
    expect(resolveChannelId("Brake Bias Wizardry")).toBeUndefined();
  });

  it("exposes labels and units", () => {
    expect(channelLabel("lat_g")).toBe("Lat G");
    expect(channelUnit("altitude")).toBe("m");
    expect(channelUnit("satellites")).toBeUndefined();
  });

  it("recognises known ids", () => {
    expect(isKnownChannel("rpm")).toBe(true);
    expect(isKnownChannel("custom:foo")).toBe(false);
  });

  it("slugs unknown columns into a collision-proof custom key", () => {
    expect(customChannelId("My Weird Sensor!")).toBe("custom:my_weird_sensor");
    expect(customChannelId("  --  ")).toBe("custom:field");
    // A custom slug can never look like a canonical id.
    expect(isKnownChannel(customChannelId("RPM-ish"))).toBe(false);
  });

  it("channelKeyFor yields the canonical id when known, else a custom slug", () => {
    expect(channelKeyFor("Lon G")).toBe("lon_g");
    expect(channelKeyFor("Gizmo Voltage")).toBe("custom:gizmo_voltage");
  });
});
