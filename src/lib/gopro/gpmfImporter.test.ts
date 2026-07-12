// Detection + routing for the GoPro MP4 importer. The extraction itself needs a
// real MP4 (and a browser), so it is verified by hand in the app; what is testable
// here is that the router claims an mp4 at all — the wiring bug class that has
// bitten this codebase twice (a perfect parser nobody could reach).

import { describe, expect, it } from "vitest";

import { isGoProFile } from "./gpmfDetect";
import { parseDatalogContent } from "../datalogParser";

/** The first 12 bytes of any mp4: size, `ftyp`, then the brand. */
function mp4Header(brand = "isom"): ArrayBuffer {
  const bytes = new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x14,
    ...[..."ftyp"].map((c) => c.charCodeAt(0)),
    ...[...brand].map((c) => c.charCodeAt(0)),
  ]);
  return bytes.buffer;
}

describe("isGoProFile", () => {
  it("claims the video containers that can carry a GPMF track", () => {
    expect(isGoProFile("GX010042.MP4")).toBe(true);
    expect(isGoProFile("gx010042.mp4")).toBe(true);
    expect(isGoProFile("clip.mov")).toBe(true);
    expect(isGoProFile("GX010042.LRV")).toBe(true);
  });

  it("sniffs the ftyp box so a renamed video is still recognised", () => {
    expect(isGoProFile("no-extension", mp4Header())).toBe(true);
    expect(isGoProFile("video", mp4Header("mp42"))).toBe(true);
  });

  it("leaves every other format alone", () => {
    expect(isGoProFile("session.gpx")).toBe(false);
    expect(isGoProFile("session.csv")).toBe(false);
    expect(isGoProFile("session.xrk")).toBe(false);
    expect(isGoProFile("track.mp4.csv")).toBe(false);

    const csv = new TextEncoder().encode("time,lat,lon\n0,1,2\n");
    expect(isGoProFile("data", csv.buffer as ArrayBuffer)).toBe(false);
  });

  it("does not read past the end of a runt buffer", () => {
    expect(isGoProFile("x", new Uint8Array([0, 0]).buffer)).toBe(false);
    expect(isGoProFile("x", new ArrayBuffer(0))).toBe(false);
  });
});

describe("the sync parse path", () => {
  it("refuses an mp4 with a clear message instead of parsing it as text", () => {
    expect(() => parseDatalogContent(mp4Header())).toThrow(
      /GoPro .mp4 files must be parsed via parseDatalogFile/,
    );
  });
});
