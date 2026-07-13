/**
 * Buffer a live RaceBox capture into a growing `ParsedData`. Sits between
 * `raceboxTransport` (raw samples off BLE) and the UI (a growing sample
 * list, a "save session" button). Pure model — no BLE, no React.
 */

import type { FieldMapping, GpsSample, ParsedData } from "@/types/racing";
import { calculateBounds, speedTriple } from "../parserUtils";
import { raceBoxSampleToDate, type RaceBoxSample } from "./raceboxDecoder";

export interface RaceBoxCaptureSnapshot {
  /** Samples emitted so far, monotonic by `t`. */
  samples: GpsSample[];
  /** Session start (UTC), set on the first accepted sample. */
  startDate: Date | undefined;
  /** Sample count — cheaper than `samples.length` for a busy chart. */
  count: number;
  /** Last sample's time-since-start, ms. */
  latestT: number;
}

export class RaceBoxCapture {
  private readonly samples: GpsSample[] = [];
  private startDate: Date | undefined;
  private t0: number | undefined;
  private lastT = -Infinity;

  /**
   * Append a decoded RaceBox sample. First sample sets `startDate`; each
   * subsequent sample's `t` is milliseconds since that start, computed from
   * the UTC year/month/day/…/nanoseconds fields (not from `Date.now()` — a
   * live stream may run through a client-clock jump).
   *
   * Drops duplicates and any sample whose t is not strictly increasing.
   */
  append(sample: RaceBoxSample): void {
    const at = raceBoxSampleToDate(sample);
    const atMs = at.getTime();
    if (!Number.isFinite(atMs)) return;

    if (this.t0 === undefined) {
      this.t0 = atMs;
      this.startDate = at;
    }
    const t = atMs - this.t0;
    if (!(t > this.lastT) && this.samples.length > 0) return;
    this.lastT = t;

    const extraFields: Record<string, number> = {
      "Altitude (m)": sample.altitudeM,
      "GPS Accuracy (m)": sample.hAccM,
      "Lat G (Native)": sample.gForceYg,   // lateral (right positive)
      "Lon G (Native)": sample.gForceXg,   // longitudinal (forward positive)
      "Yaw Rate": sample.rotRateZdps,
      HDOP: sample.pDOP,
      Satellites: sample.numSV,
    };

    this.samples.push({
      t,
      lat: sample.latitude,
      lon: sample.longitude,
      ...speedTriple(sample.speedMps),
      heading: sample.headingDeg,
      extraFields,
    });
  }

  snapshot(): RaceBoxCaptureSnapshot {
    return {
      samples: this.samples,
      startDate: this.startDate,
      count: this.samples.length,
      latestT: this.lastT === -Infinity ? 0 : this.lastT,
    };
  }

  /**
   * Produce a ParsedData over everything captured so far. Cheap to call
   * repeatedly; the samples array is shared by reference so the caller must
   * treat it as immutable (append() clones it on the next tick).
   */
  toParsedData(): ParsedData {
    const fieldMappings: FieldMapping[] = [
      { index: -1, name: "Speed", enabled: true },
      { index: -2, name: "Altitude (m)", enabled: true },
      { index: -3, name: "GPS Accuracy (m)", enabled: false },
      { index: -4, name: "Lat G (Native)", enabled: true },
      { index: -5, name: "Lon G (Native)", enabled: true },
      { index: -6, name: "Yaw Rate", enabled: false },
      { index: -7, name: "HDOP", enabled: false },
      { index: -8, name: "Satellites", enabled: false },
    ];
    return {
      samples: this.samples,
      fieldMappings,
      bounds: calculateBounds(this.samples),
      duration: this.samples.length > 0 ? this.samples[this.samples.length - 1].t : 0,
      startDate: this.startDate,
    };
  }
}
