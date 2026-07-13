/**
 * The supported-devices list, loaded from `src/data/supported-devices.json`.
 *
 * The JSON is the source of truth so that a contributor can add a device without writing any
 * TypeScript, and so the list is legible straight from the repo rather than buried in a component.
 * The same file feeds the README table.
 */

import raw from "@/data/supported-devices.json";

export type DeviceStatus = "verified" | "expected" | "partial" | "no";

export interface Device {
  name: string;
  /** Manufacturer / publisher, when it isn't obvious from the name. */
  vendor?: string;
  /** Approximate, and it will go stale — treat as a hint, not a quote. */
  price?: string;
  /** GPS fix rate, e.g. "25 Hz". The single most important number for lap timing. */
  rateHz?: string;
  /** Has an accelerometer / gyro. */
  imu?: boolean;
  /** Format ids (keys of FORMAT_LABELS) this device can give us. */
  exports: string[];
  /**
   * RacePlex can connect to this device and record from it directly, with no
   * file to export first. Web Bluetooth, so Chrome/Edge on desktop or Android.
   * This is about RacePlex talking to the hardware — not about the device being
   * able to stream to some other app.
   */
  live?: boolean;
  status: DeviceStatus;
  notes?: string;
  url?: string;
}

export interface DeviceCategory {
  id: string;
  name: string;
  blurb: string;
  devices: Device[];
}

export const FORMAT_LABELS: Record<string, string> = raw.formats;

export const CATEGORIES: DeviceCategory[] = raw.categories as DeviceCategory[];

/** Every device, flattened — for the README generator and for counting. */
export const ALL_DEVICES: Device[] = CATEGORIES.flatMap((c) => c.devices);
