// The inventory of everything this browser holds on the rider's behalf.
//
// Export and import both read this list, so they cannot drift apart. It is also
// the answer to "what would I lose if I cleared this origin?" — which is the
// question the export button exists to make un-scary.
//
// Adding a store to `dbUtils.ts` without classifying it here fails
// `dataStores.test.ts`. That is deliberate: the reason the first export shipped
// incomplete is that its store list was the *sync* list, and anything that
// didn't cloud-sync silently wasn't exported. A store is either exported or
// explicitly excluded with a reason. There is no third state.

import { STORE_NAMES } from "./dbUtils";

/** An IndexedDB store whose rows are exported as JSON. */
export interface ExportedStore {
  /** IndexedDB object-store name. */
  store: string;
  /** Why a rider would miss it — surfaced in the archive README. */
  describe: string;
}

/**
 * Document stores: rows are plain objects, exported as `local/stores/<name>.json`.
 * Everything a rider builds up that isn't a blob.
 */
export const EXPORTED_DOC_STORES: ExportedStore[] = [
  { store: STORE_NAMES.METADATA, describe: "Session metadata (track, course, vehicle, fastest lap, tire pressures)" },
  { store: STORE_NAMES.KARTS, describe: "Your vehicles" },
  { store: STORE_NAMES.NOTES, describe: "Session notes" },
  { store: STORE_NAMES.SETUPS, describe: "Vehicle setups" },
  { store: STORE_NAMES.SETUP_REVISIONS, describe: "Frozen setup history (what you actually ran, per session)" },
  { store: STORE_NAMES.SETUP_TEMPLATES, describe: "Setup templates" },
  { store: STORE_NAMES.VEHICLE_TYPES, describe: "Vehicle types" },
  { store: STORE_NAMES.ENGINES, describe: "Engine/motor list" },
  { store: STORE_NAMES.REMOTES, describe: "Remote catalog" },
  { store: STORE_NAMES.GRAPH_PREFS, describe: "Per-session graph layout" },
  { store: STORE_NAMES.LAP_SNAPSHOTS, describe: "Lap snapshots — your frozen course-fastest laps" },
  { store: STORE_NAMES.VIDEO_SYNC, describe: "Video sync offsets (which video frame is which lap)" },
  { store: STORE_NAMES.WEATHER_CACHE, describe: "Cached session weather" },
  { store: STORE_NAMES.USERS, describe: "Local user profiles on this browser" },
];

/** The raw session logs. Always exported — they're the whole point. */
export const FILE_STORE = STORE_NAMES.FILES;

/**
 * Video blobs. Exported only on request: a rider with a season of synced footage
 * has gigabytes here, and a button that silently produces a 4 GB ZIP reads as a
 * hang. The export UI measures this store and offers it as a checkbox.
 */
export const VIDEO_STORE = STORE_NAMES.SESSION_VIDEOS;

/**
 * Stores deliberately NOT exported, and why. Listed so the coverage test can
 * tell "considered and excluded" from "forgotten".
 */
export const EXCLUDED_STORES: Record<string, string> = {
  // Nothing yet. Every store is either a doc store, the file store, or the
  // video store. Kept as the seam for a future cache/derived store — if you add
  // one, put it here with the reason rather than dropping it from the inventory.
};

/**
 * localStorage keys the app writes on the rider's behalf. Exported as
 * `local/localStorage.json` (a flat key→raw-string map, so a value that isn't
 * JSON survives the round trip).
 *
 * `raceplex:settings` is dynamic — the active user's key is
 * `raceplex:settings:<userId>` for anyone but the default user — so the export
 * sweeps by prefix rather than by exact key. See `collectLocalStorage`.
 */
export const EXPORTED_LS_KEYS: string[] = [
  "racing-datalog-tracks-v2", // your custom tracks
  "racing-datalog-submitted-v1", // which tracks you've submitted upstream
  "raceplex-csv-mappings-v1", // remembered CSV column mappings — real work, and what makes an odd CSV importable at all
  "raceplex:activeUserId",
  "phoneGps:precisionWarningAck",
  "device_name",
];

/** localStorage key prefixes swept wholesale (settings are per-local-user). */
export const EXPORTED_LS_PREFIXES: string[] = ["raceplex:settings"];

/**
 * localStorage keys deliberately skipped: transient UI state and one-shot
 * migration flags. Restoring these on a new browser would be wrong — a
 * "migration already done" flag carried to a fresh origin would skip a
 * migration that origin still needs.
 */
export const EXCLUDED_LS_KEYS: string[] = [
  "raceplex:legacy-migration-done",
  "raceplex:setup-revisions:lastPrune",
  "raceplex:pending-checkout",
  "session:lastOpen",
  "session:closedExplicitly",
  "htt-debug",
  "htt-migration-dismissed",
  "racing-datalog-tracks", // legacy, superseded by -v2
];

/**
 * Plugin ids whose per-plugin KV database (`raceplex-plugin-<id>`) is exported.
 * The tools plugin persists Stance and Seat Position state there.
 */
export const EXPORTED_PLUGIN_IDS: string[] = ["tools"];

/** Should this localStorage key be exported? */
export function isExportedLsKey(key: string): boolean {
  if (EXPORTED_LS_KEYS.includes(key)) return true;
  return EXPORTED_LS_PREFIXES.some((p) => key === p || key.startsWith(`${p}:`));
}
