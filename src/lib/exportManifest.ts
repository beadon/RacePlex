// Pure assembly of a data-export archive's *text* entries (the JSON + README).
//
// Blobs (session logs, videos) are binary and get added by the orchestrator in
// dataExport.ts; keeping this layer pure makes the archive layout unit-testable
// without a browser, IndexedDB, or a zip library. The layout is also the import
// contract — dataImport.ts reads back exactly what this writes.

import { EXPORTED_DOC_STORES } from "./dataStores";

/** Everything gathered from this browser. */
export interface LocalData {
  /** IndexedDB document stores, keyed by store name. */
  stores: Record<string, unknown[]>;
  /** Raw localStorage entries (key → the raw string, so non-JSON values survive). */
  localStorage: Record<string, string>;
  /** Per-plugin KV databases, keyed by plugin id then entry key. */
  plugins: Record<string, Record<string, unknown>>;
  /** Names of the session-log blobs (added as binaries separately). */
  fileNames: string[];
  /** Names of the session-video blobs, when the rider opted to include them. */
  videoNames: string[];
}

/**
 * The optional cloud half, supplied by the cloud-sync plugin's exporter. Core
 * knows only that it's a bag of JSON documents plus a file index — it never
 * imports anything Supabase.
 */
export interface CloudData {
  /** Path (under `cloud/`) → the document to write there. */
  documents: Record<string, unknown>;
  /** Names of cloud session files (fetched and added as binaries by the caller). */
  fileNames: string[];
}

const pretty = (v: unknown): string => JSON.stringify(v ?? null, null, 2);

/**
 * Text entries of the export archive, keyed by their path inside it. Binary
 * blobs are added separately by the caller.
 */
export function buildManifest(local: LocalData, cloud?: CloudData | null): Record<string, string> {
  const files: Record<string, string> = {};

  for (const [store, rows] of Object.entries(local.stores)) {
    files[`local/stores/${store}.json`] = pretty(rows);
  }
  files["local/localStorage.json"] = pretty(local.localStorage);

  for (const [pluginId, kv] of Object.entries(local.plugins)) {
    files[`local/plugins/${pluginId}.json`] = pretty(kv);
  }

  if (cloud) {
    for (const [name, doc] of Object.entries(cloud.documents)) {
      files[`cloud/${name}.json`] = pretty(doc);
    }
    files["cloud/files-index.json"] = pretty(cloud.fileNames);
  }

  files["README.txt"] = buildReadme(local, cloud);
  return files;
}

/**
 * The archive's README. A rider who opens this ZIP in two years should be able
 * to tell what each folder is without the app, so name the contents plainly and
 * say how to get them back in.
 */
export function buildReadme(local: LocalData, cloud?: CloudData | null, now: Date = new Date()): string {
  const storeLines = EXPORTED_DOC_STORES.filter((s) => (local.stores[s.store]?.length ?? 0) > 0).map(
    (s) => `  ${(local.stores[s.store]?.length ?? 0).toString().padStart(5)}  ${s.describe}`,
  );

  const lines = [
    "RacePlex — your data",
    `Exported: ${now.toISOString()}`,
    "",
    "This archive is everything RacePlex was holding for you in this browser. It is",
    "yours. RacePlex has no account and no server: your data has only ever been on",
    "your own device, which is also why it disappears if you clear the browser or",
    "switch to a new one. That is what this archive is for.",
    "",
    "TO RESTORE IT",
    "  Open RacePlex, go to Settings, and choose Import data. Pick this .zip file.",
    "  Existing sessions are never overwritten.",
    "",
    "WHAT'S IN HERE",
    "",
    `  local/files/         ${local.fileNames.length} session log(s), in their original format`,
  ];

  if (local.videoNames.length) {
    lines.push(`  local/videos/        ${local.videoNames.length} session video(s)`);
  }

  lines.push(
    "  local/stores/        your garage, as JSON:",
    ...(storeLines.length ? storeLines : ["         (empty)"]),
    "  local/localStorage/  app settings, custom tracks, saved CSV column mappings",
    "  local/plugins/       saved state from the in-app tools",
  );

  if (cloud) {
    lines.push(
      "",
      `  cloud/               data held under your account on the server`,
      `  cloud/files/         ${cloud.fileNames.length} session log(s) you chose to sync`,
    );
  }

  lines.push(
    "",
    "Every .json file is UTF-8 and opens in any text editor. Session logs keep their",
    "original names and formats (CSV, GPX, UBX, .fit, …), so they also open in any",
    "other tool that reads them — you are not locked in to RacePlex.",
  );

  return lines.join("\n");
}
