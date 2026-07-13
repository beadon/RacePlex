/**
 * RaceChrono CSV v3 preprocessor tests (issue #33). We don't have a real
 * export in the repo yet, so these tests build fixtures matching the shape
 * documented in the issue: BOM, `Format,3` sniff, metadata pairs, three-row
 * header (name / unit / source), then data.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { isRaceChronoCsvV3, rewriteRaceChronoCsvV3 } from "./raceChronoCsv";
import { parseCsvTable } from "./csvTable";
import { parseDatalogContent } from "./datalogParser";

/** Fresh in-memory localStorage for the router path (csvMappingStorage reads it). */
function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  });
}

const BOM = "﻿";

/** Minimal well-formed v3 CSV: 3 rows of data, two duplicate `speed` columns. */
function fixtureV3(): string {
  return (
    BOM +
    "Session data\n" +
    "Format,3\n" +
    "Session name,Test run\n" +
    "Session start,2025-06-15 14:30:00\n" +
    "\n" +
    "time,latitude,longitude,speed,speed,satellites,fix_type\n" +
    "s,deg,deg,km/h,m/s,,\n" +
    "100: gps,100: gps,100: gps,100: gps,calc,100: gps,100: gps\n" +
    "0.00,42.5000000,-8.6000000,0.0,0.00,12,3.0\n" +
    "0.10,42.5000010,-8.6000000,3.6,1.00,12,3.0\n" +
    "0.20,42.5000030,-8.6000000,7.2,2.00,12,3.0\n"
  );
}

describe("isRaceChronoCsvV3", () => {
  it("accepts the vendor's own line-2 signature", () => {
    expect(isRaceChronoCsvV3(fixtureV3())).toBe(true);
  });

  it("accepts without the BOM", () => {
    expect(isRaceChronoCsvV3(fixtureV3().slice(1))).toBe(true);
  });

  it("rejects a plain CSV that just happens to have 'Format' somewhere", () => {
    const other = "time,lat,lon\nFormat,3,extra\n1,42,8\n";
    expect(isRaceChronoCsvV3(other)).toBe(false);
  });

  it("rejects Format,2 (older RaceChrono exports)", () => {
    const v2 = BOM + "Session data\nFormat,2\ntime,lat,lon\n1,42,8\n";
    expect(isRaceChronoCsvV3(v2)).toBe(false);
  });

  it("rejects a file too short to check", () => {
    expect(isRaceChronoCsvV3("Session data\n")).toBe(false);
    expect(isRaceChronoCsvV3("")).toBe(false);
  });
});

describe("rewriteRaceChronoCsvV3", () => {
  it("produces a flat single-header CSV parseable by parseCsvTable", () => {
    const flat = rewriteRaceChronoCsvV3(fixtureV3());
    const table = parseCsvTable(flat);
    expect(table.rows).toHaveLength(3);
    // First-occurrence columns keep the clean name (so the generic mapper's
    // aliases still find lat/lon/time/speed by their canonical names).
    expect(table.columns).toContain("latitude (deg)");
    expect(table.columns).toContain("longitude (deg)");
  });

  it("disambiguates the SECOND `speed` column by its source, keeps the first clean", () => {
    // The vendor's own export can have `speed` twice: once from GPS, once
    // computed. Keying by name alone would silently lose one.
    const flat = rewriteRaceChronoCsvV3(fixtureV3());
    const table = parseCsvTable(flat);
    // First `speed` — clean name, unit-annotated.
    expect(table.columns).toContain("speed (km/h)");
    // Second `speed` — disambiguated by source.
    expect(table.columns).toContain("speed@calc (m/s)");
  });

  it("carries the unit annotation into the header so downstream reads it", () => {
    const flat = rewriteRaceChronoCsvV3(fixtureV3());
    const table = parseCsvTable(flat);
    expect(table.columns.some((c) => /km\/h/i.test(c))).toBe(true);
    expect(table.columns.some((c) => /m\/s/i.test(c))).toBe(true);
  });

  it("drops the metadata pairs and doesn't emit blank lines", () => {
    const flat = rewriteRaceChronoCsvV3(fixtureV3());
    expect(flat).not.toContain("Session name");
    expect(flat).not.toContain("Session start");
    expect(flat.split("\n").filter((l) => !l.trim())).toHaveLength(0);
  });

  it("throws on a non-v3 file", () => {
    expect(() => rewriteRaceChronoCsvV3("not a raceChrono file\n1,2\n")).toThrow();
  });
});

describe("datalogParser routes RaceChrono v3", () => {
  beforeEach(installMemoryLocalStorage);

  it("imports a v3 fixture end-to-end via the router", () => {
    const data = parseDatalogContent(fixtureV3());
    // Three rows of data → three samples.
    expect(data.samples.length).toBe(3);
    // Positions from the `100: gps` columns.
    expect(data.samples[0].lat).toBeCloseTo(42.5, 6);
    expect(data.samples[0].lon).toBeCloseTo(-8.6, 6);
    // Duplicate `speed` columns: the mapper prefers the FIRST occurrence
    // (the km/h one), keyed on its clean name. 3.6 km/h == 1 m/s.
    expect(data.samples[1].speedMps).toBeCloseTo(1.0, 2);
  });

  it("beats the loose Alfano/AiM detectors that grep for `lap`/`rpm`", () => {
    // A v3 export whose session name literally contains a motorsport token
    // used to be mis-claimed by isAlfanoFormat (which searches for `lap`
    // anywhere in the first 3 KB). The router's new ordered table puts the
    // exact `Format,3` sniff ahead of the loose ones — see issue #33.
    const bomV3 = fixtureV3().replace("Test run", "Test lap");
    const data = parseDatalogContent(bomV3);
    expect(data.samples.length).toBe(3);
    expect(data.samples[1].speedMps).toBeCloseTo(1.0, 2);
  });
});

