// "Download my data" — the core, offline, no-account export.
//
// RacePlex keeps everything in the browser, which means a cleared origin or a
// new laptop loses the lot. This is the way out. It is core (not the cloud-sync
// plugin, where the original export lived) because a build with no backend —
// which is every stock RacePlex build — must still let a rider take their data.
// Nothing here imports Supabase.
//
// The cloud plugin composes this: it calls `collectLocalData()` + `buildManifest()`
// with its own cloud half, so there is one archive layout and one importer.
//
// JSZip is dynamic-imported so it stays off the eager bundle.

import { withReadTransaction } from "./dbUtils";
import {
  EXPORTED_DOC_STORES,
  EXPORTED_PLUGIN_IDS,
  FILE_STORE,
  VIDEO_STORE,
  isExportedLsKey,
} from "./dataStores";
import { buildManifest, type CloudData, type LocalData } from "./exportManifest";
import { getFile, listFiles } from "./fileStorage";
import { getPluginStore } from "@/plugins/storage";

export interface ExportProgress {
  /** Human-readable phase, surfaced in the UI. */
  phase: string;
  /** 0–1 when known; omitted for indeterminate phases. */
  ratio?: number;
}

export interface ExportOptions {
  /** Include session videos. Off by default — they can run to gigabytes. */
  includeVideos?: boolean;
  onProgress?: (p: ExportProgress) => void;
}

/** A stored video row, as `videoFileStorage` writes it. */
interface StoredVideoRow {
  sessionFileName: string;
  data?: Blob;
}

/**
 * Total bytes of stored session videos, so the UI can tell a rider what
 * including them will cost before they wait for it.
 */
export async function estimateVideoBytes(): Promise<{ count: number; bytes: number }> {
  try {
    const rows = await withReadTransaction<StoredVideoRow[]>(VIDEO_STORE, (s) => s.getAll());
    let bytes = 0;
    for (const row of rows) bytes += row?.data?.size ?? 0;
    return { count: rows.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Every localStorage entry the inventory says is the rider's, raw. */
function collectLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isExportedLsKey(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) out[key] = value;
    }
  } catch {
    // Storage can throw in a locked-down/private context. An export missing
    // settings still beats no export.
  }
  return out;
}

/** Each plugin's KV database, as a plain key→value map. */
async function collectPlugins(): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of EXPORTED_PLUGIN_IDS) {
    try {
      const store = getPluginStore(id);
      const keys = await store.keys();
      if (!keys.length) continue;
      const kv: Record<string, unknown> = {};
      for (const key of keys) kv[key] = await store.get(key);
      out[id] = kv;
    } catch {
      // A plugin that isn't installed in this build has no database. Skip it.
    }
  }
  return out;
}

/**
 * Read everything this browser holds for the rider. Used by the core export and
 * by the cloud plugin's account export, so both archives have the same layout.
 */
export async function collectLocalData(includeVideos = false): Promise<LocalData> {
  const stores: Record<string, unknown[]> = {};
  for (const { store } of EXPORTED_DOC_STORES) {
    try {
      stores[store] = await withReadTransaction<unknown[]>(store, (s) => s.getAll());
    } catch {
      // A store missing on this install (an older DB version) is empty, not fatal.
      stores[store] = [];
    }
  }

  const fileNames = (await listFiles()).map((f) => f.name);

  let videoNames: string[] = [];
  if (includeVideos) {
    try {
      const rows = await withReadTransaction<StoredVideoRow[]>(VIDEO_STORE, (s) => s.getAll());
      videoNames = rows.map((r) => r.sessionFileName).filter(Boolean);
    } catch {
      videoNames = [];
    }
  }

  return {
    stores,
    localStorage: collectLocalStorage(),
    plugins: await collectPlugins(),
    fileNames,
    videoNames,
  };
}

/** Read one stored video blob by its session file name. */
async function getVideoBlob(sessionFileName: string): Promise<Blob | null> {
  try {
    const row = await withReadTransaction<StoredVideoRow | undefined>(VIDEO_STORE, (s) =>
      s.get(sessionFileName),
    );
    return row?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the export archive. Shared by the core export and the cloud plugin's
 * account export — pass `cloud` (plus a fetcher for its blobs) to include the
 * server-side half.
 */
export async function buildArchive(
  local: LocalData,
  opts: {
    cloud?: CloudData | null;
    fetchCloudFile?: (name: string) => Promise<Blob | null>;
    onProgress?: (p: ExportProgress) => void;
  } = {},
): Promise<Blob> {
  const { cloud = null, fetchCloudFile, onProgress } = opts;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  for (const [path, content] of Object.entries(buildManifest(local, cloud))) {
    zip.file(path, content);
  }

  // Session logs.
  const total = local.fileNames.length + local.videoNames.length + (cloud?.fileNames.length ?? 0);
  let done = 0;
  const step = (phase: string) => {
    done++;
    onProgress?.({ phase, ratio: total ? done / total : undefined });
  };

  for (const name of local.fileNames) {
    const blob = await getFile(name);
    if (blob) zip.file(`local/files/${name}`, blob);
    step(`Adding sessions… (${done + 1}/${total})`);
  }

  // Session videos (only present when the rider opted in).
  for (const name of local.videoNames) {
    const blob = await getVideoBlob(name);
    if (blob) zip.file(`local/videos/${name}`, blob);
    step(`Adding videos… (${done + 1}/${total})`);
  }

  // Cloud blobs, when the cloud plugin supplied a fetcher.
  if (cloud && fetchCloudFile) {
    for (const name of cloud.fileNames) {
      const blob = await fetchCloudFile(name);
      if (blob) zip.file(`cloud/files/${name}`, blob);
      step(`Downloading synced sessions… (${done + 1}/${total})`);
    }
  }

  onProgress?.({ phase: "Compressing…" });
  return zip.generateAsync({ type: "blob" });
}

/** File name for an export archive, dated so successive exports don't collide. */
export function exportFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `raceplex-data-${stamp}.zip`;
}

/** Hand a blob to the browser as a download. */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The whole flow: gather, zip, download. This is what the Settings / Tools /
 * Files buttons call. Works with no account and no network.
 */
export async function downloadMyData(opts: ExportOptions = {}): Promise<void> {
  const { includeVideos = false, onProgress } = opts;
  onProgress?.({ phase: "Gathering your data…" });
  const local = await collectLocalData(includeVideos);
  const blob = await buildArchive(local, { onProgress });
  triggerDownload(blob, exportFileName());
}
