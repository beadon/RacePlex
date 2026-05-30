import { lazy } from "react";
import { Camera, Cloud, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import type { DataViewerPlugin } from "@/plugins/types";
import { PANELS_POINT, PanelSlot, type PluginPanel } from "@/plugins/panels";
import {
  MOUNTS_POINT, MountSlot,
  type PluginMountDef, type FileRowContext, type FileManagerSectionContext,
  type FileDeleteConfirmContext,
} from "@/plugins/mounts";

// The per-file toggle, cloud-only list, and bulk-download button: lazy so the
// file-manager drawer doesn't pull the sync engine onto its chunk until they
// render (see Bundle Splitting in CLAUDE.md).
const FileSyncToggle = lazy(() => import("./FileSyncToggle"));
const FileDeleteToggle = lazy(() => import("./FileDeleteToggle"));
const CloudFilesSection = lazy(() => import("./CloudFilesSection"));
const DownloadAllCloudLogs = lazy(() => import("./DownloadAllCloudLogs"));
// Profile tab panels: merged account + storage meters, and cloud-log management.
// Lazy so the Supabase sync engine + storage modules load only when the Profile
// tab is opened, keeping the initial bundle lean.
const StoragePanel = lazy(() => import("./StoragePanel"));
const CloudLogsPanel = lazy(() => import("./CloudLogsPanel"));
const LapSnapshotsPanel = lazy(() => import("./LapSnapshotsPanel"));
// Profile tab: GDPR self-service — export everything + scheduled account deletion.
const DataPrivacyPanel = lazy(() => import("./DataPrivacyPanel"));

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';

const plugin: DataViewerPlugin = {
  id: "cloud-sync",
  name: "Cloud Sync",
  version: "0.1.0",
  setup(ctx) {
    // Offline-first guard: when the cloud flag is off, contribute nothing.
    // No panels/mounts register, their chunks never load, and the Labs tab
    // stays hidden unless another plugin contributes there.
    if (!enableCloud) return;

    // "Download all cloud logs" bulk action at the bottom of the file list.
    // (Sign-in itself lives on the Profile tab — see StoragePanel below.)
    ctx.registry.contribute(MOUNTS_POINT, {
      id: "cloud-sync-download-all",
      slot: MountSlot.FileManagerFooter,
      order: 0,
      component: DownloadAllCloudLogs,
    } satisfies PluginMountDef<FileManagerSectionContext>);

    // Per-file sync toggle injected into each file-manager row.
    ctx.registry.contribute(MOUNTS_POINT, {
      id: "cloud-sync-file-toggle",
      slot: MountSlot.FileRow,
      order: 0,
      component: FileSyncToggle,
    } satisfies PluginMountDef<FileRowContext>);

    // "Also delete from the cloud" opt-in, shown in the file delete-confirm
    // banner when the file is synced.
    ctx.registry.contribute(MOUNTS_POINT, {
      id: "cloud-sync-file-delete",
      slot: MountSlot.FileDeleteConfirm,
      order: 0,
      component: FileDeleteToggle,
    } satisfies PluginMountDef<FileDeleteConfirmContext>);

    // Cloud-only files (in the cloud, not on this device) listed under the file
    // list, each with a per-file pull.
    ctx.registry.contribute(MOUNTS_POINT, {
      id: "cloud-sync-cloud-files",
      slot: MountSlot.FileManagerSection,
      order: 0,
      component: CloudFilesSection,
    } satisfies PluginMountDef<FileManagerSectionContext>);

    // Profile tab: merged account + storage. Signed in it shows display name,
    // sign-out, plan, and cloud usage; signed out it offers sign-in and the same
    // storage bar measured against this device. Ordered first (top of the tab).
    ctx.registry.contribute(PANELS_POINT, {
      id: "cloud-sync-storage",
      title: "Account",
      slot: PanelSlot.Profile,
      order: 0,
      icon: User,
      component: StoragePanel,
    } satisfies PluginPanel);

    // Profile tab: view/delete lap snapshots (cloud when signed in, local when
    // signed out — the one snapshot feature available before sign-in).
    ctx.registry.contribute(PANELS_POINT, {
      id: "cloud-sync-snapshots",
      title: "Lap snapshots",
      slot: PanelSlot.Profile,
      order: 5,
      icon: Camera,
      component: LapSnapshotsPanel,
    } satisfies PluginPanel);

    // Profile tab: manage (delete) the log files stored in the cloud.
    ctx.registry.contribute(PANELS_POINT, {
      id: "cloud-sync-logs",
      title: "Cloud logs",
      slot: PanelSlot.Profile,
      order: 10,
      icon: Cloud,
      component: CloudLogsPanel,
    } satisfies PluginPanel);

    // Profile tab: data export + account deletion (GDPR self-service). Last so
    // the destructive controls sit at the bottom of the tab.
    ctx.registry.contribute(PANELS_POINT, {
      id: "cloud-sync-data-privacy",
      title: "Data & privacy",
      slot: PanelSlot.Profile,
      order: 20,
      icon: ShieldCheck,
      component: DataPrivacyPanel,
    } satisfies PluginPanel);

    // Background document auto-sync. Dynamically imported so the sync engine
    // stays off the initial bundle; the notifier routes quota warnings to a
    // toast (keeping autoSync itself free of any UI dependency).
    void import("./autoSync").then((m) => {
      m.setAutoSyncNotifier((msg, kind) => (kind === "error" ? toast.error(msg) : toast(msg)));
      m.startAutoSync();
    });
  },
};

export default plugin;
