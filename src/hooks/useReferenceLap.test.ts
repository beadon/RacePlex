import { describe, expect, it } from "vitest";
import { lapTimeDeltaToFastest } from "./useReferenceLap";

const lap = (lapNumber: number, lapTimeMs: number) => ({ lapNumber, lapTimeMs });

describe("lapTimeDeltaToFastest", () => {
  const laps = [lap(1, 65_000), lap(2, 62_000), lap(3, 63_000)];

  it("measures the selected lap against the fastest one", () => {
    expect(lapTimeDeltaToFastest(laps, 1)).toBe(3_000);
    expect(lapTimeDeltaToFastest(laps, 3)).toBe(1_000);
  });

  it("is zero on the fastest lap itself, when other laps exist to be slower", () => {
    // Here 0.000 is a real measurement — it means "this is the best one".
    expect(lapTimeDeltaToFastest(laps, 2)).toBe(0);
  });

  /**
   * The regression this file exists for.
   *
   * A single-lap session has nothing to compare against: that lap is trivially its own fastest.
   * Reporting 0.000s there is a lap compared against ITSELF — not a measurement — and it filled
   * the "Δ best" panel with zeros, which reads as a broken chart.
   *
   * This is the common case for eskate, not an edge case: a hill run, a slalom or a drag pass is
   * point-to-point and usually a single run. (It only became reachable once point-to-point course
   * support landed — before that such sessions produced no laps at all, so the panel never showed.)
   */
  it("returns null for a single-lap session — there is no comparison to make", () => {
    expect(lapTimeDeltaToFastest([lap(1, 36_547)], 1)).toBeNull();
  });

  it("returns null when there are no laps, or none selected", () => {
    expect(lapTimeDeltaToFastest([], 1)).toBeNull();
    expect(lapTimeDeltaToFastest(laps, null)).toBeNull();
  });

  it("returns null when the selected lap isn't in the list", () => {
    expect(lapTimeDeltaToFastest(laps, 99)).toBeNull();
  });
});
