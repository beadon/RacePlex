// Restore a data-export archive back into this browser.
//
// The other half of dataExport.ts, and the reason the export is worth having:
// an export you can't put back is a museum piece. Both sides read the same
// inventory in dataStores.ts, so the round trip closes (see dataImport.test.ts).
//
// Local by construction — it writes IndexedDB and localStorage and talks to no
// server. Restoring an archive never overwrites an existing session log: same
// name, keep what's already here. Garage rows are upserted by key, which is what
// you want when re-importing a newer export over an older one.

import { withWriteTransaction } from "./dbUtils";
import { EXPORTED_DOC_STORES, EXPORTED_PLUGIN_IDS, isExportedLsKey } from "./dataStores";
import { listFiles, saveFile } from "./fileStorage";
import { getPluginStore } from "@/plugins/storage";

export interface ImportSummary {
  /** Session logs written (an existing name is kept, never clobbered). */
  files: number;
  /** Session logs skipped because that name is already here. */
  filesSkipped: number;
  /** Videos written. */
  videos: number;
  /** Garage rows written, across all stores. */
  records: number;
  /** Stores that received at least one row. */
  stores: number;
  /** localStorage entries written (settings, tracks, CSV mappings). */
  settings: number;
}

export interface ImportProgress {
  phase: string;
}

export type EntryKind =
  | { kind: "store"; store: string }
  | { kind: "file"; name: string }
  | { kind: "video"; name: string }
  | { kind: "localStorage" }
  | { kind: "plugin"; pluginId: string }
  | null;

/**
 * Classify one path inside an export archive. Pure, so the path rules are
 * testable without a zip.
 *
 * Anything unrecognised returns null and is ignored. This is a trust boundary:
 * a ZIP is user-supplied input and its paths are attacker-controlled, so the
 * caller matches store names against the inventory allowlist rather than
 * writing to whatever store a path names. `cloud/files/` is accepted as a
 * session log — a cloud-era archive restores into a local-only build.
 */
export function classifyEntry(path: string): EntryKind {
  const store = path.match(/^local\/stores\/(.+)\.json$/);
  if (store) return { kind: "store", store: store[1] };

  const video = path.match(/^local\/videos\/(.+)$/);
  if (video?.[1]) return { kind: "video", name: video[1] };

  const file = path.match(/^(?:local|cloud)\/files\/(.+)$/);
  if (file?.[1]) return { kind: "file", name: file[1] };

  if (path === "local/localStorage.json") return { kind: "localStorage" };

  const plugin = path.match(/^local\/plugins\/(.+)\.json$/);
  if (plugin?.[1]) return { kind: "plugin", pluginId: plugin[1] };

  return null;
}

/** A stored video row, matching what videoFileStorage writes. */
interface StoredVideoRow {
  sessionFileName: string;
  data: Blob;
  size: number;
  savedAt: number;
}

/**
 * Read an export archive and restore it into this browser. Returns what was
 * actually written, so the UI can say so rather than claiming success blandly.
 */
export async function importArchive(
  blob: Blob,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportSummary> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(blob);

  const summary: ImportSummary = {
    files: 0,
    filesSkipped: 0,
    videos: 0,
    records: 0,
    stores: 0,
    settings: 0,
  };

  // Garage stores. Iterate the *inventory*, not the archive, so a path in the
  // ZIP can never name a store we didn't intend to write.
  onProgress?.({ phase: "Restoring your garage…" });
  for (const { store } of EXPORTED_DOC_STORES) {
    const entry = zip.file(`local/stores/${store}.json`);
    if (!entry) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(await entry.async("string"));
    } catch {
      continue; // A corrupt store file shouldn't abort the whole restore.
    }
    if (!Array.isArray(rows)) continue;

    let touched = false;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      try {
        await withWriteTransaction(store, (s) => s.put(row));
        summary.records++;
        touched = true;
      } catch {
        // A row the current schema rejects (an older export, a since-changed
        // key path) is skipped rather than failing the import.
      }
    }
    if (touched) summary.stores++;
  }

  // Settings, tracks, CSV mappings.
  onProgress?.({ phase: "Restoring settings…" });
  const lsEntry = zip.file("local/localStorage.json");
  if (lsEntry) {
    try {
      const parsed: unknown = JSON.parse(await lsEntry.async("string"));
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          // Allowlist again on the way in: an archive must not be able to set
          // an arbitrary localStorage key on this origin.
          if (!isExportedLsKey(key) || typeof value !== "string") continue;
          localStorage.setItem(key, value);
          summary.settings++;
        }
      }
    } catch {
      // Non-fatal: the rest of the archive still restores.
    }
  }

  // Per-plugin tool state.
  for (const pluginId of EXPORTED_PLUGIN_IDS) {
    const entry = zip.file(`local/plugins/${pluginId}.json`);
    if (!entry) continue;
    try {
      const kv: unknown = JSON.parse(await entry.async("string"));
      if (!kv || typeof kv !== "object") continue;
      const store = getPluginStore(pluginId);
      for (const [key, value] of Object.entries(kv as Record<string, unknown>)) {
        await store.set(key, value);
      }
    } catch {
      // Skip a plugin whose state won't parse.
    }
  }

  // Session logs. Never clobber a name that's already here — a rider restoring
  // an old archive over a live browser must not lose today's session.
  onProgress?.({ phase: "Restoring sessions…" });
  const existing = new Set((await listFiles()).map((f) => f.name));
  const files: { name: string; entry: import("jszip").JSZipObject }[] = [];
  const videos: { name: string; entry: import("jszip").JSZipObject }[] = [];

  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const c = classifyEntry(path);
    if (!c) return;
    if (c.kind === "file") files.push({ name: c.name, entry });
    if (c.kind === "video") videos.push({ name: c.name, entry });
  });

  for (const { name, entry } of files) {
    if (existing.has(name)) {
      summary.filesSkipped++;
      continue;
    }
    await saveFile(name, await entry.async("blob"));
    existing.add(name); // local/ and cloud/ can hold the same name; write it once.
    summary.files++;
  }

  if (videos.length) {
    onProgress?.({ phase: "Restoring videos…" });
    for (const { name, entry } of videos) {
      const data = await entry.async("blob");
      const row: StoredVideoRow = {
        sessionFileName: name,
        data,
        size: data.size,
        savedAt: Date.now(),
      };
      try {
        await withWriteTransaction("session-videos", (s) => s.put(row));
        summary.videos++;
      } catch {
        // Out of quota is the likely cause here; keep the rest of the restore.
      }
    }
  }

  return summary;
}
