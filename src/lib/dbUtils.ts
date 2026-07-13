/**
 * Shared IndexedDB utilities.
 * All storage modules share the same database ("raceplex") and version.
 * The schema is defined here once to avoid duplication across storage files.
 *
 * A one-shot migration in `legacyDbMigration.ts` copies data from the previous
 * `dove-file-manager` database on first startup after upgrade, then deletes
 * the old one; users don't lose anything.
 */

export const DB_NAME = "raceplex";
export const DB_VERSION = 15;

export const STORE_NAMES = {
  FILES: "files",
  METADATA: "metadata",
  KARTS: "karts",           // still "karts" for IDB compat, holds Vehicle objects
  NOTES: "notes",
  SETUPS: "setups",
  VIDEO_SYNC: "video-sync",
  GRAPH_PREFS: "graph-prefs",
  VEHICLE_TYPES: "vehicle-types",
  SETUP_TEMPLATES: "setup-templates",
  SESSION_VIDEOS: "session-videos",
  ENGINES: "engines",       // reusable engine-type list for vehicle profiles
  LAP_SNAPSHOTS: "lap-snapshots", // frozen "course fastest lap" captures per engine
  SETUP_REVISIONS: "setup-revisions", // immutable, content-addressed frozen setups (session history)
  WEATHER_CACHE: "weather-cache", // per-session historical weather (local-only, never cloud-synced)
  USERS: "users",           // v14: local user profiles for shared-machine scoping (plan 0011)
  REMOTES: "remotes",       // v15: shared remote catalog (Hoyt Puck, Flipsky VX, …), plan 0010
} as const;

/**
 * Stores whose rows carry a `userId` (plan 0011 — local users). The v14
 * migration back-fills every existing row with the default user's id, and
 * scoped storage modules append their `userId` on save + filter on read.
 *
 * Tracks are NOT here — tracks live in localStorage and are global by design.
 * Users, obviously, aren't here either. Everything else that a rider builds up
 * is per-user.
 */
/**
 * The seed user id used by the v14 migration to back-fill pre-existing rows.
 * Duplicated verbatim in `localUserStorage.ts` — dbUtils can't import that
 * module (circular), and this migration must run inside `onupgradeneeded` where
 * async imports aren't available. Change both in lockstep.
 */
const DEFAULT_USER_ID_LOCAL = "default-user";
const DEFAULT_USER_NAME_LOCAL = "Me";

export const USER_SCOPED_STORES = [
  STORE_NAMES.FILES,
  STORE_NAMES.METADATA,
  STORE_NAMES.KARTS,
  STORE_NAMES.NOTES,
  STORE_NAMES.SETUPS,
  STORE_NAMES.VIDEO_SYNC,
  STORE_NAMES.GRAPH_PREFS,
  STORE_NAMES.VEHICLE_TYPES,
  STORE_NAMES.SETUP_TEMPLATES,
  STORE_NAMES.REMOTES,
  STORE_NAMES.SESSION_VIDEOS,
  STORE_NAMES.ENGINES,
  STORE_NAMES.LAP_SNAPSHOTS,
  STORE_NAMES.SETUP_REVISIONS,
  STORE_NAMES.WEATHER_CACHE,
] as const;

/**
 * Open the shared IndexedDB database, creating/upgrading all object stores as needed.
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Original stores (v1-v7)
      if (!db.objectStoreNames.contains(STORE_NAMES.FILES)) {
        db.createObjectStore(STORE_NAMES.FILES, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.METADATA)) {
        db.createObjectStore(STORE_NAMES.METADATA, { keyPath: "fileName" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.KARTS)) {
        db.createObjectStore(STORE_NAMES.KARTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.NOTES)) {
        const notesStore = db.createObjectStore(STORE_NAMES.NOTES, { keyPath: "id" });
        notesStore.createIndex("fileName", "fileName", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.SETUPS)) {
        const setupsStore = db.createObjectStore(STORE_NAMES.SETUPS, { keyPath: "id" });
        setupsStore.createIndex("kartId", "kartId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.VIDEO_SYNC)) {
        db.createObjectStore(STORE_NAMES.VIDEO_SYNC, { keyPath: "sessionFileName" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.GRAPH_PREFS)) {
        db.createObjectStore(STORE_NAMES.GRAPH_PREFS, { keyPath: "sessionFileName" });
      }

      // v8: New stores for vehicle types and setup templates
      if (!db.objectStoreNames.contains(STORE_NAMES.VEHICLE_TYPES)) {
        db.createObjectStore(STORE_NAMES.VEHICLE_TYPES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.SETUP_TEMPLATES)) {
        db.createObjectStore(STORE_NAMES.SETUP_TEMPLATES, { keyPath: "id" });
      }

      // v9: Session videos store
      if (!db.objectStoreNames.contains(STORE_NAMES.SESSION_VIDEOS)) {
        db.createObjectStore(STORE_NAMES.SESSION_VIDEOS, { keyPath: "sessionFileName" });
      }

      // v10: Reusable engine-type list
      if (!db.objectStoreNames.contains(STORE_NAMES.ENGINES)) {
        db.createObjectStore(STORE_NAMES.ENGINES, { keyPath: "id" });
      }

      // v11: Lap snapshots ("course fastest lap" per engine), keyed by a stable
      // id and indexed by course (for the lap-list picker) and engine.
      if (!db.objectStoreNames.contains(STORE_NAMES.LAP_SNAPSHOTS)) {
        const snapStore = db.createObjectStore(STORE_NAMES.LAP_SNAPSHOTS, { keyPath: "id" });
        snapStore.createIndex("courseKey", "courseKey", { unique: false });
        snapStore.createIndex("engineKey", "engineKey", { unique: false });
      }

      // v12: Immutable setup revisions — content-addressed (id = SHA-256 of the
      // setup content) frozen copies, so a session keeps the exact setup it ran
      // even after the live setup is edited. Indexed by the originating setup.
      if (!db.objectStoreNames.contains(STORE_NAMES.SETUP_REVISIONS)) {
        const revStore = db.createObjectStore(STORE_NAMES.SETUP_REVISIONS, { keyPath: "id" });
        revStore.createIndex("setupId", "setupId", { unique: false });
      }

      // v13: Per-session historical weather cache. A session's date never
      // changes, so its looked-up weather is immutable — cache it locally and
      // stop re-pinging the weather station/API on every reopen. Keyed by the
      // file name; deliberately NOT in the cloud-sync store list (local-only).
      if (!db.objectStoreNames.contains(STORE_NAMES.WEATHER_CACHE)) {
        db.createObjectStore(STORE_NAMES.WEATHER_CACHE, { keyPath: "fileName" });
      }

      // v14: Local user profiles (plan 0011). A row per profile on this
      // browser install; the active user's id lives in localStorage. All
      // pre-existing rows in scoped stores get back-filled with a default
      // seed user's id so nothing disappears on upgrade.
      if (!db.objectStoreNames.contains(STORE_NAMES.USERS)) {
        db.createObjectStore(STORE_NAMES.USERS, { keyPath: "id" });
      }

      // v15: Reusable remote catalog (Hoyt Puck, Flipsky VX, Metr, …). Per
      // plan 0010: each user has their own catalog seeded from a common list
      // on first save; every row carries a `userId` like other scoped stores.
      if (!db.objectStoreNames.contains(STORE_NAMES.REMOTES)) {
        db.createObjectStore(STORE_NAMES.REMOTES, { keyPath: "id" });
      }

      // v14 migration: seed the default local user and back-fill every scoped
      // store's rows with its id (plan 0011). Idempotent — a re-run finds the
      // seed user already there and every row already tagged, and does nothing.
      if (oldVersion < 14) {
        try {
          const usersStore = request.transaction!.objectStore(STORE_NAMES.USERS);
          const getUserReq = usersStore.get(DEFAULT_USER_ID_LOCAL);
          getUserReq.onsuccess = () => {
            if (!getUserReq.result) {
              usersStore.put({
                id: DEFAULT_USER_ID_LOCAL,
                name: DEFAULT_USER_NAME_LOCAL,
                createdAt: Date.now(),
              });
            }
          };
        } catch {
          // Users store doesn't exist yet — the create above handles it. The
          // seed will be written on next open via `ensureDefaultUser`.
        }

        // Back-fill every scoped store's rows with the default user's id.
        for (const storeName of USER_SCOPED_STORES) {
          try {
            const store = request.transaction!.objectStore(storeName);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
              for (const row of getAllReq.result) {
                if (!row.userId) {
                  row.userId = DEFAULT_USER_ID_LOCAL;
                  store.put(row);
                }
              }
            };
          } catch {
            // Store may not exist yet on fresh installs — the createObjectStore
            // above handled it, and an empty store has nothing to back-fill.
          }
        }
      }

      // v8 migration: add vehicleId index to setups if upgrading from v7
      if (oldVersion < 8) {
        try {
          const setupsStore = request.transaction!.objectStore(STORE_NAMES.SETUPS);
          if (!setupsStore.indexNames.contains("vehicleId")) {
            setupsStore.createIndex("vehicleId", "vehicleId", { unique: false });
          }
        } catch {
          // Store may not exist yet in fresh installs, handled above
        }

        // Migrate existing karts: add vehicleTypeId if missing
        try {
          const kartsStore = request.transaction!.objectStore(STORE_NAMES.KARTS);
          const getAllReq = kartsStore.getAll();
          getAllReq.onsuccess = () => {
            const karts = getAllReq.result;
            for (const kart of karts) {
              if (!kart.vehicleTypeId) {
                kart.vehicleTypeId = "default-kart-type";
                kartsStore.put(kart);
              }
            }
          };
        } catch {
          // Ignore if store doesn't exist yet
        }

        // Migrate existing setups: move hardcoded fields to customFields
        try {
          const setupsStore = request.transaction!.objectStore(STORE_NAMES.SETUPS);
          const getAllReq = setupsStore.getAll();
          getAllReq.onsuccess = () => {
            const setups = getAllReq.result;
            for (const setup of setups) {
              if (setup.customFields) continue; // already migrated

              // Build customFields from old hardcoded fields
              const customFields: Record<string, string | number | null> = {};
              if (setup.toe !== undefined) customFields["f-toe"] = setup.toe ?? null;
              if (setup.camber !== undefined) customFields["f-camber"] = setup.camber ?? null;
              if (setup.castor !== undefined) customFields["f-castor"] = setup.castor ?? null;
              if (setup.frontWidth !== undefined) customFields["f-front-width"] = setup.frontWidth ?? null;
              if (setup.rearWidth !== undefined) customFields["f-rear-width"] = setup.rearWidth ?? null;
              if (setup.rearHeight !== undefined) customFields["f-rear-height"] = setup.rearHeight ?? null;
              if (setup.frontSprocket !== undefined) customFields["f-front-sprocket"] = setup.frontSprocket ?? null;
              if (setup.rearSprocket !== undefined) customFields["f-rear-sprocket"] = setup.rearSprocket ?? null;
              if (setup.steeringBrand !== undefined) customFields["f-steering-brand"] = setup.steeringBrand || null;
              if (setup.steeringSetting !== undefined) customFields["f-steering-setting"] = setup.steeringSetting ?? null;
              if (setup.spindleSetting !== undefined) customFields["f-spindle-setting"] = setup.spindleSetting ?? null;

              // Determine unitSystem from old per-field units
              const unitSystem = setup.frontWidthUnit || setup.rearWidthUnit || setup.tireWidthUnit || "mm";

              // Map kartId → vehicleId
              setup.vehicleId = setup.kartId || setup.vehicleId || "";
              setup.templateId = setup.templateId || "default-kart-template";
              setup.unitSystem = unitSystem;
              setup.customFields = customFields;

              // Keep tire fields as-is (they're first-class)
              setup.tireBrand = setup.tireBrand || "";
              setup.tireDiameterMode = setup.tireDiameterMode || "halves";

              setupsStore.put(setup);
            }
          };
        } catch {
          // Ignore
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run a readwrite transaction on a store and wait for it to complete.
 */
export async function withWriteTransaction<T>(
  storeName: string,
  operation: (store: IDBObjectStore) => IDBRequest | void
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  operation(store);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Run a readonly transaction and return the result.
 */
export async function withReadTransaction<T>(
  storeName: string,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = operation(store);
  const result = await new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
