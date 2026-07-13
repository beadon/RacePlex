import { describe, it, expect } from "vitest";
import type { GpsSample, ParsedData } from "@/types/racing";
import { foldGoProChapters } from "./gpmfSequence";

function sample(t: number, lat = 42.5, lon = -8.6): GpsSample {
  return { t, lat, lon, speedMps: 10, speedKph: 36, speedMph: 22.4, extraFields: {} };
}

function chapter(startMs: number, sampleTs: number[]): ParsedData {
  const samples = sampleTs.map((t) => sample(t));
  return {
    samples,
    fieldMappings: [{ index: -1, name: "Speed", enabled: true }],
    bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    duration: sampleTs[sampleTs.length - 1],
    startDate: new Date(startMs),
  };
}

describe("foldGoProChapters", () => {
  it("passes a single chapter through unchanged", () => {
    const c = chapter(1_000, [0, 100, 200]);
    const folded = foldGoProChapters([c]);
    expect(folded).toBe(c); // reference equality — no work to do
  });

  it("rebases chapter 2 by the UTC gap between chapter 1 and 2 start", () => {
    // Chapter 1: 30s, starts at t=1000s. Chapter 2: 30s, starts at t=1032s (2s pause).
    const c1 = chapter(1_000_000, [0, 10_000, 20_000, 30_000]);
    const c2 = chapter(1_032_000, [0, 10_000, 20_000, 30_000]);
    const folded = foldGoProChapters([c1, c2]);

    // Chapter 2 first sample lands at 32_000ms (32s), matching real-world gap.
    expect(folded.samples.length).toBe(8);
    expect(folded.samples[3].t).toBe(30_000);
    expect(folded.samples[4].t).toBe(32_000);
    expect(folded.samples[7].t).toBe(62_000);
    expect(folded.duration).toBe(62_000);
    // First chapter's startDate wins.
    expect(folded.startDate?.getTime()).toBe(1_000_000);
  });

  it("preserves fieldMappings from the first chapter", () => {
    const c1 = chapter(1_000, [0, 100]);
    const c2 = chapter(2_000, [0, 100]);
    const folded = foldGoProChapters([c1, c2]);
    expect(folded.fieldMappings).toEqual(c1.fieldMappings);
  });

  it("re-derives bounds from the folded samples (not the first chapter's)", () => {
    const c1: ParsedData = { ...chapter(1_000, [0]), samples: [sample(0, 40, -8)] };
    const c2: ParsedData = { ...chapter(2_000, [0]), samples: [sample(0, 42, -9)] };
    const folded = foldGoProChapters([c1, c2]);
    expect(folded.bounds.minLat).toBe(40);
    expect(folded.bounds.maxLat).toBe(42);
    expect(folded.bounds.minLon).toBe(-9);
    expect(folded.bounds.maxLon).toBe(-8);
  });

  it("falls back to previous-chapter-end + 1ms when a chapter has no startDate", () => {
    const c1 = chapter(1_000, [0, 100, 200]);
    const c2Base = chapter(2_000, [0, 100]);
    const c2WithoutDate: ParsedData = { ...c2Base, startDate: undefined };
    const folded = foldGoProChapters([c1, c2WithoutDate]);
    expect(folded.samples[2].t).toBe(200);
    expect(folded.samples[3].t).toBe(201); // 200 + 1ms nudge
    expect(folded.samples[4].t).toBe(301);
  });

  it("skips empty chapters", () => {
    const c1 = chapter(1_000, [0, 100]);
    const empty: ParsedData = { ...chapter(2_000, []), samples: [], duration: 0 };
    const c3 = chapter(3_000, [0, 100]);
    const folded = foldGoProChapters([c1, empty, c3]);
    expect(folded.samples.length).toBe(4);
    // Chapter 3 lands at real-world 2000ms gap.
    expect(folded.samples[2].t).toBe(2_000);
  });

  it("throws when the chapter list is empty", () => {
    expect(() => foldGoProChapters([])).toThrow(/no chapters/i);
  });
});
