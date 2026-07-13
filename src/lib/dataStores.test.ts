import { describe, it, expect } from "vitest";
import { STORE_NAMES } from "./dbUtils";
import {
  EXPORTED_DOC_STORES,
  EXPORTED_LS_KEYS,
  EXPORTED_LS_PREFIXES,
  EXCLUDED_LS_KEYS,
  EXCLUDED_STORES,
  FILE_STORE,
  VIDEO_STORE,
  isExportedLsKey,
} from "./dataStores";

describe("dataStores inventory", () => {
  // The guard. A store added to dbUtils.ts and not classified here would be
  // silently absent from every export — which is exactly how the first export
  // shipped missing lap snapshots, CSV mappings and tool state. Fail loudly
  // instead: classify the new store as exported, or excluded with a reason.
  it("classifies every IndexedDB store — export it or exclude it with a reason", () => {
    const classified = new Set<string>([
      ...EXPORTED_DOC_STORES.map((s) => s.store),
      FILE_STORE,
      VIDEO_STORE,
      ...Object.keys(EXCLUDED_STORES),
    ]);

    const unclassified = Object.values(STORE_NAMES).filter((s) => !classified.has(s));

    expect(
      unclassified,
      `Unclassified IndexedDB store(s): ${unclassified.join(", ")}. ` +
        `Add each to EXPORTED_DOC_STORES in dataStores.ts, or to EXCLUDED_STORES with the reason it must not travel.`,
    ).toEqual([]);
  });

  it("does not both export and exclude a store", () => {
    const exported = [...EXPORTED_DOC_STORES.map((s) => s.store), FILE_STORE, VIDEO_STORE];
    for (const store of exported) {
      expect(EXCLUDED_STORES[store], `${store} is both exported and excluded`).toBeUndefined();
    }
  });

  it("lists no store twice", () => {
    const stores = EXPORTED_DOC_STORES.map((s) => s.store);
    expect(new Set(stores).size).toBe(stores.length);
  });

  it("gives every exported store a description for the archive README", () => {
    for (const s of EXPORTED_DOC_STORES) {
      expect(s.describe.length, `${s.store} needs a description`).toBeGreaterThan(0);
    }
  });

  it("keeps the file and video stores out of the doc-store list (they are blobs)", () => {
    const docs = EXPORTED_DOC_STORES.map((s) => s.store);
    expect(docs).not.toContain(FILE_STORE);
    expect(docs).not.toContain(VIDEO_STORE);
  });
});

describe("isExportedLsKey", () => {
  it("exports the rider's own data", () => {
    expect(isExportedLsKey("racing-datalog-tracks-v2")).toBe(true);
    expect(isExportedLsKey("raceplex-csv-mappings-v1")).toBe(true);
  });

  it("exports settings for the default user and for a named local user", () => {
    expect(isExportedLsKey("raceplex:settings")).toBe(true);
    expect(isExportedLsKey("raceplex:settings:user-abc123")).toBe(true);
  });

  it("skips transient state and one-shot migration flags", () => {
    // Carrying "migration already done" to a fresh origin would skip a
    // migration that origin still needs — a silent data loss on restore.
    for (const key of EXCLUDED_LS_KEYS) {
      expect(isExportedLsKey(key), `${key} must not be exported`).toBe(false);
    }
  });

  it("skips an unknown key rather than exporting whatever else is on the origin", () => {
    expect(isExportedLsKey("some-other-app-key")).toBe(false);
    expect(isExportedLsKey("raceplex:settingsomething")).toBe(false);
  });

  it("never lists a key as both exported and excluded", () => {
    for (const key of EXPORTED_LS_KEYS) {
      expect(EXCLUDED_LS_KEYS, `${key} is both exported and excluded`).not.toContain(key);
    }
    for (const prefix of EXPORTED_LS_PREFIXES) {
      expect(EXCLUDED_LS_KEYS).not.toContain(prefix);
    }
  });
});
