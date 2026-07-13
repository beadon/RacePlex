// The GDPR "Download my data" export for signed-in users: everything the core
// export gathers from this browser, PLUS the server-side account document and
// the session files the user chose to sync.
//
// The local half is NOT reimplemented here. It lives in `lib/dataExport.ts` —
// core, offline, no Supabase — and this composes it. That split is the point:
// the original version of this file owned both halves, which meant (a) a build
// with no backend, which is every stock RacePlex build, had no way to export at
// all, and (b) the local half quietly tracked the *sync* store list and so
// dropped lap snapshots, CSV mappings, tool state and more. One archive layout,
// one importer, one inventory (`lib/dataStores.ts`).

import { supabase } from "@/integrations/supabase/client";
import { buildArchive, collectLocalData, exportFileName, triggerDownload, type ExportProgress } from "@/lib/dataExport";
import type { CloudData } from "@/lib/exportManifest";
import { downloadCloudFile } from "./syncEngine";

export type { ExportProgress };

/** The server-side export document returned by the export-account-data function. */
interface CloudExportDoc {
  account?: unknown;
  profile?: unknown;
  subscription?: unknown;
  roles?: unknown;
  pending_deletion?: unknown;
  cloud_files?: Array<{ name: string }>;
  garage_records?: unknown;
  contact_messages?: unknown;
}

/** Fetch the server-side account export. Returns null when signed out. */
async function fetchCloudExport(): Promise<CloudExportDoc | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.functions.invoke("export-account-data");
  if (error) throw new Error(error.message);
  return data as CloudExportDoc;
}

/** Reshape the server document into the core archive's cloud half. */
function toCloudData(doc: CloudExportDoc): CloudData {
  const documents: Record<string, unknown> = {
    account: doc.account,
    profile: doc.profile,
    subscription: doc.subscription,
    roles: doc.roles ?? [],
    "garage-records": doc.garage_records ?? [],
    "contact-messages": doc.contact_messages ?? [],
  };
  if (doc.pending_deletion) documents["pending-deletion"] = doc.pending_deletion;

  return {
    documents,
    fileNames: (doc.cloud_files ?? []).map((f) => f.name),
  };
}

/**
 * Build the full export ZIP (local + cloud) and hand it to the browser. Signed
 * out, this is exactly the core export — so it still works with no account.
 */
export async function downloadAccountExport(
  onProgress?: (p: ExportProgress) => void,
  includeVideos = false,
): Promise<void> {
  onProgress?.({ phase: "Gathering your data…" });
  const [doc, local] = await Promise.all([fetchCloudExport(), collectLocalData(includeVideos)]);
  const cloud = doc ? toCloudData(doc) : null;

  // Cloud blobs are fetched with the user's own session, lazily per file, so a
  // large account doesn't hold every blob in memory at once.
  let fetchCloudFile: ((name: string) => Promise<Blob | null>) | undefined;
  if (cloud?.fileNames.length) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      fetchCloudFile = (name: string) => downloadCloudFile(user.id, name);
    } else {
      cloud.fileNames = [];
    }
  }

  const blob = await buildArchive(local, { cloud, fetchCloudFile, onProgress });
  triggerDownload(blob, exportFileName());
}
