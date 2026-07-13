/**
 * One-shot migration from upstream's `dove-*` naming to `raceplex-*`.
 *
 * The fork inherited three naming surfaces:
 *   1. IndexedDB database `dove-file-manager` (all core stores).
 *   2. Plugin IndexedDB databases `dove-plugin-<id>` (one per plugin).
 *   3. localStorage keys prefixed `dove-dataviewer-` / `dove-`.
 *
 * None of the names are user-visible, but they leak into every code review,
 * every export, and every troubleshooting session — the project isn't a
 * single-vendor product, so the storage layer shouldn't be named after one.
 *
 * This module runs the rename at first startup on a build that ships v15+ of
 * the core schema, and it's designed to be safe to call on every subsequent
 * startup (a completed migration is a no-op). Users keep every file, garage
 * item, and setting.
 */

const LEGACY_DB_NAME = "dove-file-manager";
export const CORE_DB_NAME = "raceplex";

const LEGACY_PLUGIN_PREFIX = "dove-plugin-";
export const PLUGIN_DB_PREFIX = "raceplex-plugin-";

/**
 * localStorage rename map. Each entry is `[legacyKey, newKey]` — the migration
 * copies value across and deletes the legacy key. New code reads/writes the
 * new key; the migration handles first-boot on an upgraded install.
 */
const LOCALSTORAGE_RENAMES: Array<readonly [legacy: string, next: string]> = [
  ["dove-dataviewer-settings", "raceplex:settings"],
  ["dove-pending-checkout", "raceplex:pending-checkout"],
  ["dove:setup-revisions:lastPrune", "raceplex:setup-revisions:lastPrune"],
];

const MIGRATION_MARKER = "raceplex:legacy-migration-done";

/**
 * Check whether an IndexedDB database exists (without opening it) — Chromium
 * exposes `indexedDB.databases()` for this; Firefox may not, in which case we
 * fall back to an open-and-close probe on a fresh version, deleting if empty.
 */
async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  const anyIdb = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof anyIdb.databases === "function") {
    try {
      const list = await anyIdb.databases();
      return list.some((entry) => entry.name === name);
    } catch {
      // fall through to probe
    }
  }
  // Fallback: open at version 1; if the DB was newly created (empty), delete
  // it and report false — otherwise it existed already.
  return await new Promise<boolean>((resolve) => {
    let created = false;
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      created = true;
    };
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      const hasStores = db.objectStoreNames.length > 0;
      db.close();
      if (created && !hasStores) {
        const del = indexedDB.deleteDatabase(name);
        del.onsuccess = () => resolve(false);
        del.onerror = () => resolve(false);
      } else {
        resolve(!created);
      }
    };
  });
}

/**
 * Copy every store from `src` into `dst`. `dst` is opened with the same
 * version as `src` and every source store is recreated with its keyPath +
 * indexes preserved. Only used by the legacy → raceplex migration; new
 * schema evolution stays in `dbUtils.ts`.
 */
async function copyDatabase(srcName: string, dstName: string): Promise<void> {
  const src = await openReadonly(srcName);
  const srcVersion = src.version;
  const storeSchemas: Array<{
    name: string;
    keyPath: string | string[] | null;
    autoIncrement: boolean;
    indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }>;
  }> = [];

  for (const storeName of src.objectStoreNames) {
    const tx = src.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }> = [];
    for (const indexName of store.indexNames) {
      const idx = store.index(indexName);
      indexes.push({
        name: idx.name,
        keyPath: idx.keyPath as string | string[],
        unique: idx.unique,
        multiEntry: idx.multiEntry,
      });
    }
    storeSchemas.push({
      name: storeName,
      keyPath: store.keyPath as string | string[] | null,
      autoIncrement: store.autoIncrement,
      indexes,
    });
  }

  // Recreate empty destination with the same schema.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(dstName, srcVersion);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const schema of storeSchemas) {
        if (db.objectStoreNames.contains(schema.name)) continue;
        const opts: IDBObjectStoreParameters = { autoIncrement: schema.autoIncrement };
        if (schema.keyPath !== null) opts.keyPath = schema.keyPath;
        const store = db.createObjectStore(schema.name, opts);
        for (const idx of schema.indexes) {
          store.createIndex(idx.name, idx.keyPath, { unique: idx.unique, multiEntry: idx.multiEntry });
        }
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });

  const dst = await openReadonly(dstName, "readwrite");
  // Copy row-by-row per store — one transaction per store keeps the tx
  // scope tight and any per-store failure isolated.
  for (const schema of storeSchemas) {
    // Read every row up-front from src (one tx), then bulk-put in one dst tx.
    // Interleaving cursor reads + writes across two DBs races the transaction
    // lifecycle: the dst tx can auto-commit before we register `oncomplete`.
    const rows: Array<{ value: unknown; primaryKey: IDBValidKey }> = await new Promise((resolve, reject) => {
      const srcTx = src.transaction(schema.name, "readonly");
      const collected: Array<{ value: unknown; primaryKey: IDBValidKey }> = [];
      const req = srcTx.objectStore(schema.name).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return; // srcTx.oncomplete will resolve below
        collected.push({ value: cursor.value, primaryKey: cursor.primaryKey });
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      srcTx.oncomplete = () => resolve(collected);
      srcTx.onerror = () => reject(srcTx.error);
    });

    if (rows.length === 0) continue;

    await new Promise<void>((resolve, reject) => {
      const dstTx = dst.transaction(schema.name, "readwrite");
      const dstStore = dstTx.objectStore(schema.name);
      for (const { value, primaryKey } of rows) {
        if (schema.keyPath === null) dstStore.put(value, primaryKey);
        else dstStore.put(value);
      }
      dstTx.oncomplete = () => resolve();
      dstTx.onerror = () => reject(dstTx.error);
    });
  }
  src.close();
  dst.close();
}

async function openReadonly(name: string, defaultMode: IDBTransactionMode = "readonly"): Promise<IDBDatabase> {
  void defaultMode;
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best-effort; if we can't delete the old, we still succeeded on the copy
    req.onblocked = () => resolve();
  });
}

/**
 * Migrate every legacy `dove-plugin-*` database to `raceplex-plugin-*`. Runs
 * as part of the one-shot migration; safe to call more than once (missing
 * legacy DBs are skipped).
 */
async function migratePluginDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const anyIdb = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof anyIdb.databases !== "function") return; // Firefox: skip; plugins will lazily start fresh.
  const list = await anyIdb.databases();
  const legacy = list
    .map((entry) => entry.name)
    .filter((name): name is string => !!name && name.startsWith(LEGACY_PLUGIN_PREFIX));
  for (const oldName of legacy) {
    const newName = PLUGIN_DB_PREFIX + oldName.slice(LEGACY_PLUGIN_PREFIX.length);
    try {
      if (await databaseExists(newName)) continue;
      await copyDatabase(oldName, newName);
      await deleteDatabase(oldName);
    } catch (e) {
      console.warn(`Legacy plugin DB migration failed for ${oldName}:`, e);
    }
  }
}

/**
 * Rename any legacy `dove-*` localStorage keys to their `raceplex:*` names,
 * synchronously. Called from the top of `main.tsx` *before* any other module
 * reads localStorage (settings, i18n, palette, etc.), so first paint reads the
 * user's real settings under the new key even on the first upgraded boot.
 * Idempotent — missing legacy keys and already-migrated installs are no-ops.
 */
export function migrateLocalStorageSync(): void {
  if (typeof localStorage === "undefined") return;
  for (const [legacy, next] of LOCALSTORAGE_RENAMES) {
    try {
      const val = localStorage.getItem(legacy);
      if (val === null) continue;
      if (localStorage.getItem(next) === null) localStorage.setItem(next, val);
      localStorage.removeItem(legacy);
    } catch {
      // storage disabled — carry on
    }
  }
}

/**
 * Run the one-shot rename migration. Called from app startup **before**
 * anything else opens IndexedDB. Idempotent — a completed migration is
 * recorded in localStorage and skipped on subsequent boots.
 */
export async function runLegacyDbMigration(): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      if (localStorage.getItem(MIGRATION_MARKER) === "1") return;
    } catch {
      // fall through — worst case we probe the DB and find nothing to do
    }
  }

  try {
    migrateLocalStorageSync();

    const [legacyExists, newExists] = await Promise.all([
      databaseExists(LEGACY_DB_NAME),
      databaseExists(CORE_DB_NAME),
    ]);

    if (legacyExists && !newExists) {
      await copyDatabase(LEGACY_DB_NAME, CORE_DB_NAME);
      await deleteDatabase(LEGACY_DB_NAME);
    }

    await migratePluginDatabases();

    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(MIGRATION_MARKER, "1");
      } catch {
        // storage disabled — every boot will re-probe (cheap) and no-op
      }
    }
  } catch (e) {
    console.warn("Legacy DB migration failed; continuing with fresh raceplex DB:", e);
  }
}
