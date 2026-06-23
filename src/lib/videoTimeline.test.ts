import { describe, it, expect } from "vitest";
import {
  sessionMsToVideoSec,
  videoSecToSessionMs,
  videoCoverageMs,
  coverageOf,
  lapCoverage,
} from "./videoTimeline";

// The video sync anchor is absolute session time: one syncOffsetMs maps the
// whole session timeline onto the recording, so lap/range changes never move it.

describe("sessionMsToVideoSec / videoSecToSessionMs", () => {
  it("round-trips through the offset", () => {
    const offset = 5000; // camera started 5s after the datalogger
    expect(sessionMsToVideoSec(5000, offset)).toBe(0);
    expect(sessionMsToVideoSec(35000, offset)).toBe(30);
    expect(videoSecToSessionMs(30, offset)).toBe(35000);
    expect(videoSecToSessionMs(sessionMsToVideoSec(42000, offset), offset)).toBeCloseTo(42000, 6);
  });

  it("handles a negative offset (camera started before the datalogger)", () => {
    const offset = -2000;
    expect(sessionMsToVideoSec(0, offset)).toBe(2); // session start is 2s into the video
    expect(videoSecToSessionMs(0, offset)).toBe(-2000);
  });

  it("is independent of which lap a sample belongs to (sync once)", () => {
    const offset = 5000;
    // The same absolute sample time maps to the same video time regardless of
    // how the cursor reached it (lap 1 view vs lap 2 view vs all-laps).
    const sampleAbsMs = 95000; // somewhere in a later lap
    expect(sessionMsToVideoSec(sampleAbsMs, offset)).toBe(90);
    // Re-deriving from a different "view" (no offset change) is identical.
    expect(sessionMsToVideoSec(sampleAbsMs, offset)).toBe(90);
  });
});

describe("videoCoverageMs", () => {
  it("returns the session-time window the footage spans", () => {
    expect(videoCoverageMs(5000, 120)).toEqual({ startMs: 5000, endMs: 125000 });
  });
});

describe("coverageOf", () => {
  const offset = 5000;
  const duration = 120; // 2 min of footage starting 5s into the session

  it("flags session times before the footage starts", () => {
    expect(coverageOf(0, offset, duration)).toBe("before");
    expect(coverageOf(4999, offset, duration)).toBe("before");
  });

  it("flags session times within the footage", () => {
    expect(coverageOf(5000, offset, duration)).toBe("covered");
    expect(coverageOf(60000, offset, duration)).toBe("covered");
    expect(coverageOf(125000, offset, duration)).toBe("covered");
  });

  it("flags session times after the footage ends", () => {
    expect(coverageOf(125001, offset, duration)).toBe("after");
    expect(coverageOf(180000, offset, duration)).toBe("after");
  });
});

describe("lapCoverage", () => {
  const offset = 5000;
  const duration = 120; // covers session [5000, 125000] ms

  it("none when the lap is entirely outside the footage", () => {
    expect(lapCoverage(0, 4000, offset, duration)).toBe("none");
    expect(lapCoverage(130000, 140000, offset, duration)).toBe("none");
  });

  it("full when the lap is entirely inside the footage", () => {
    expect(lapCoverage(10000, 90000, offset, duration)).toBe("full");
  });

  it("partial when the lap straddles a footage boundary", () => {
    expect(lapCoverage(0, 60000, offset, duration)).toBe("partial"); // starts before footage
    expect(lapCoverage(100000, 140000, offset, duration)).toBe("partial"); // ends after footage
  });
});
