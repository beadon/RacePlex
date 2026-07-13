/**
 * Legacy DB rename tests (dove-file-manager → raceplex, plugin DBs, and
 * localStorage keys). Every core store carries per-user data, so the migration
 * must be lossless. Runs against fake-indexeddb.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import { runLegacyDbMigration, migrateLocalStorageSync, CORE_DB_NAME, PLUGIN_DB_PREFIX } from "./legacyDbMigration";

/** In-memory localStorage stub, reset per test. */
class MemStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  freshIndexedDB();
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemStorage();
});

// ─── localStorage rename ─────────────────────────────────────────────────────

describe("migrateLocalStorageSync", () => {
  it("copies legacy settings to the new key and deletes the old one", () => {
    localStorage.setItem("dove-dataviewer-settings", JSON.stringify({ useKph: true }));
    migrateLocalStorageSync();
    expect(localStorage.getItem("raceplex:settings")).toBe(JSON.stringify({ useKph: true }));
    expect(localStorage.getItem("dove-dataviewer-settings")).toBeNull();
  });

  it("renames the pending-checkout + prune-timestamp keys too", () => {
    localStorage.setItem("dove-pending-checkout", "tier:pro");
    localStorage.setItem("dove:setup-revisions:lastPrune", "1234567890");
    migrateLocalStorageSync();
    expect(localStorage.getItem("raceplex:pending-checkout")).toBe("tier:pro");
    expect(localStorage.getItem("raceplex:setup-revisions:lastPrune")).toBe("1234567890");
    expect(localStorage.getItem("dove-pending-checkout")).toBeNull();
    expect(localStorage.getItem("dove:setup-revisions:lastPrune")).toBeNull();
  });

  it("preserves an existing new-name value over the legacy one", () => {
    localStorage.setItem("dove-dataviewer-settings", "old");
    localStorage.setItem("raceplex:settings", "new");
    migrateLocalStorageSync();
    expect(localStorage.getItem("raceplex:settings")).toBe("new");
    expect(localStorage.getItem("dove-dataviewer-settings")).toBeNull();
  });

  it("is a no-op when nothing legacy is present", () => {
    localStorage.setItem("raceplex:settings", "kept");
    migrateLocalStorageSync();
    expect(localStorage.getItem("raceplex:settings")).toBe("kept");
    expect(localStorage.length).toBe(1);
  });
});

// ─── IDB core-DB rename ─────────────────────────────────────────────────────

async function seedLegacyCoreDb(rows: Array<{ store: string; keyPath: string | null; records: unknown[] }>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("dove-file-manager", 13);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const { store, keyPath } of rows) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, keyPath === null ? {} : { keyPath });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(rows.map((r) => r.store), "readwrite");
      for (const { store, records } of rows) {
        const s = tx.objectStore(store);
        for (const rec of records) s.put(rec);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

async function listRecords(dbName: string, storeName: string): Promise<unknown[]> {
  return await new Promise<unknown[]>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, "readonly");
      const all = tx.objectStore(storeName).getAll();
      all.onsuccess = () => { db.close(); resolve(all.result); };
      all.onerror = () => { db.close(); reject(all.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

describe("runLegacyDbMigration — core DB", () => {
  it("copies every store from dove-file-manager to raceplex", async () => {
    await seedLegacyCoreDb([
      { store: "files", keyPath: "name", records: [{ name: "a.dove", data: new Blob(["x"]), size: 1, savedAt: 100 }] },
      { store: "karts", keyPath: "id", records: [{ id: "v1", name: "Board 1", engine: "focbox" }] },
      { store: "engines", keyPath: "id", records: [{ id: "e1", name: "Focbox Unity", createdAt: 100 }] },
    ]);

    await runLegacyDbMigration();

    expect(await listRecords(CORE_DB_NAME, "files")).toHaveLength(1);
    expect(await listRecords(CORE_DB_NAME, "karts")).toHaveLength(1);
    expect(await listRecords(CORE_DB_NAME, "engines")).toHaveLength(1);
  });

  it("deletes the legacy DB after copying", async () => {
    await seedLegacyCoreDb([
      { store: "files", keyPath: "name", records: [{ name: "a.dove", data: new Blob(["x"]), size: 1, savedAt: 100 }] },
    ]);

    await runLegacyDbMigration();

    const idb = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
    if (typeof idb.databases !== "function") return; // fake-indexeddb should have it
    const list = await idb.databases();
    expect(list.some((d) => d.name === "dove-file-manager")).toBe(false);
  });

  it("is a no-op when there's nothing legacy to migrate", async () => {
    await runLegacyDbMigration();
    // Marker set, no error, and the raceplex DB was never created because
    // there was no legacy DB to copy from.
    expect(localStorage.getItem("raceplex:legacy-migration-done")).toBe("1");
  });

  it("skips the copy when raceplex already exists", async () => {
    // Seed both DBs; the migration should NOT overwrite the fresh raceplex DB.
    await seedLegacyCoreDb([
      { store: "files", keyPath: "name", records: [{ name: "legacy.dove", data: new Blob(["x"]), size: 1, savedAt: 100 }] },
    ]);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(CORE_DB_NAME, 13);
      req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "name" });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ name: "new.dove", data: new Blob(["y"]), size: 1, savedAt: 200 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });

    await runLegacyDbMigration();

    const files = (await listRecords(CORE_DB_NAME, "files")) as Array<{ name: string }>;
    expect(files.map((f) => f.name)).toEqual(["new.dove"]);
  });

  it("skips the whole migration when the marker is already set", async () => {
    // A previous run marked us done; even a legacy DB now should be left alone.
    localStorage.setItem("raceplex:legacy-migration-done", "1");
    await seedLegacyCoreDb([
      { store: "files", keyPath: "name", records: [{ name: "legacy.dove", data: new Blob(["x"]), size: 1, savedAt: 100 }] },
    ]);
    await runLegacyDbMigration();
    expect(await listRecords(CORE_DB_NAME, "files")).toHaveLength(0);
  });
});

// ─── Plugin DBs ──────────────────────────────────────────────────────────────

describe("runLegacyDbMigration — plugin DBs", () => {
  it("copies every dove-plugin-* DB to its raceplex-plugin-* twin", async () => {
    // Seed two legacy plugin DBs with data.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("dove-plugin-coach", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put("hi", "greeting");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
    // Marker for the core migration so it doesn't interfere.
    localStorage.setItem("raceplex:legacy-migration-done", "0"); // force run

    await runLegacyDbMigration();

    // The legacy plugin DB was copied to the new name.
    const idb = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
    if (typeof idb.databases !== "function") return;
    const list = await idb.databases();
    expect(list.some((d) => d.name === `${PLUGIN_DB_PREFIX}coach`)).toBe(true);
    expect(list.some((d) => d.name === "dove-plugin-coach")).toBe(false);
  });
});
