/**
 * Unit tests for the position-marker heading math shared by RaceLineView and
 * MiniMap.
 */

import { describe, it, expect } from "vitest";
import { markerHeading } from "./mapMarker";

describe("markerHeading", () => {
  it("uses the sample's own heading when present", () => {
    const samples = [
      { lat: 0, lon: 0, heading: 0 },
      { lat: 1, lon: 1, heading: 123.4 },
    ];
    expect(markerHeading(samples, 1)).toBe(123.4);
  });

  it("derives the bearing from movement when heading is missing/zero", () => {
    const samples = [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 }, // due north
    ];
    expect(markerHeading(samples, 1)).toBe(0);
    const east = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 }, // due east
    ];
    expect(markerHeading(east, 1)).toBe(90);
  });

  it("returns 0 when stationary with no heading", () => {
    const samples = [
      { lat: 10, lon: 10 },
      { lat: 10, lon: 10 },
    ];
    expect(markerHeading(samples, 1)).toBe(0);
  });

  it("returns 0 for an out-of-range index", () => {
    expect(markerHeading([], 0)).toBe(0);
    expect(markerHeading([{ lat: 0, lon: 0 }], 5)).toBe(0);
  });
});
