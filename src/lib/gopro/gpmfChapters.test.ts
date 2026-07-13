import { describe, it, expect } from "vitest";
import { groupGoProChapters, parseGoProChapterName } from "./gpmfChapters";

/** Cheap File stub — the grouping only reads .name. */
function f(name: string): File {
  return new File([""], name, { type: "video/mp4" });
}

describe("parseGoProChapterName", () => {
  it("parses GX (HERO 7+)", () => {
    expect(parseGoProChapterName("GX010042.MP4")).toEqual({
      prefix: "GX", chapter: 1, scene: "0042", ext: ".MP4",
    });
    expect(parseGoProChapterName("GX030042.MP4")?.chapter).toBe(3);
  });

  it("parses GH (HERO 4-6) and GL (HERO12 low-power 360)", () => {
    expect(parseGoProChapterName("GH020017.MP4")?.prefix).toBe("GH");
    expect(parseGoProChapterName("GL010003.LRV")?.prefix).toBe("GL");
  });

  it("treats GOPR (HERO 3+ chapter 1) and GP (chapters 2+) as legacy", () => {
    expect(parseGoProChapterName("GOPR0042.MP4")).toEqual({
      prefix: "GOPR", chapter: 1, scene: "0042", ext: ".MP4",
    });
    expect(parseGoProChapterName("GP020042.MP4")).toEqual({
      prefix: "GP", chapter: 2, scene: "0042", ext: ".MP4",
    });
  });

  it("case-insensitive; strips leading path", () => {
    expect(parseGoProChapterName("gx020017.mp4")?.chapter).toBe(2);
    expect(parseGoProChapterName("/path/to/GX010001.MP4")?.chapter).toBe(1);
    expect(parseGoProChapterName("dir\\GX010001.mp4")?.chapter).toBe(1);
  });

  it("returns null for non-GoPro names", () => {
    expect(parseGoProChapterName("session.mp4")).toBeNull();
    expect(parseGoProChapterName("IMG_1234.mp4")).toBeNull();
    expect(parseGoProChapterName("GX01.mp4")).toBeNull(); // too short
  });
});

describe("groupGoProChapters", () => {
  it("folds three chapters of the same recording, in chapter order", () => {
    const files = [f("GX030042.MP4"), f("GX010042.MP4"), f("GX020042.MP4")];
    const groups = groupGoProChapters(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((x) => x.name)).toEqual(["GX010042.MP4", "GX020042.MP4", "GX030042.MP4"]);
  });

  it("keeps different scenes separate", () => {
    const files = [f("GX010042.MP4"), f("GX020042.MP4"), f("GX010043.MP4")];
    const groups = groupGoProChapters(files);
    // Two groups: {42:1,42:2} and {43:1}
    expect(groups).toHaveLength(2);
    const bySize = [...groups].sort((a, b) => b.length - a.length);
    expect(bySize[0].map((x) => x.name)).toEqual(["GX010042.MP4", "GX020042.MP4"]);
    expect(bySize[1].map((x) => x.name)).toEqual(["GX010043.MP4"]);
  });

  it("folds legacy GOPR + GP as one recording", () => {
    const files = [f("GOPR0042.MP4"), f("GP020042.MP4"), f("GP030042.MP4")];
    const groups = groupGoProChapters(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((x) => x.name)).toEqual([
      "GOPR0042.MP4", "GP020042.MP4", "GP030042.MP4",
    ]);
  });

  it("puts non-GoPro files in their own single-file groups", () => {
    const files = [f("GX010042.MP4"), f("session.dove"), f("session.vbo")];
    const groups = groupGoProChapters(files);
    expect(groups).toHaveLength(3);
    const solos = groups.filter((g) => g.length === 1);
    expect(solos.map((g) => g[0].name).sort()).toEqual(["GX010042.MP4", "session.dove", "session.vbo"]);
  });

  it("treats GX and GH as distinct camera families (different scenes)", () => {
    // Same scene id but different prefix — different cameras → different recordings.
    const files = [f("GX010042.MP4"), f("GH010042.MP4")];
    const groups = groupGoProChapters(files);
    expect(groups).toHaveLength(2);
  });
});
