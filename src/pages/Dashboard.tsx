import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoggerDownload } from "@/components/LoggerDownload";
import { TrackEditor } from "@/components/TrackEditor";
import { SettingsModal } from "@/components/SettingsModal";
import { ToolsDialog } from "@/components/ToolsDialog";
import { SupportedDevicesDialog } from "@/components/SupportedDevicesDialog";
import { SupportedFilesDialog } from "@/components/SupportedFilesDialog";
import { AboutDialog } from "@/components/AboutDialog";
import { Button } from "@/components/ui/button";
import { SessionsSummaryTile } from "@/components/dashboard/SessionsSummaryTile";
import { RecentSessionsTile } from "@/components/dashboard/RecentSessionsTile";
import { GarageTile } from "@/components/dashboard/GarageTile";
import { TracksTile } from "@/components/dashboard/TracksTile";
import { DevicesTile } from "@/components/dashboard/DevicesTile";
import { ImportTile } from "@/components/dashboard/ImportTile";
import type { AppSettings } from "@/hooks/useSettings";
import type { CanonicalFieldId } from "@/lib/fieldResolver";
import type { ParsedData } from "@/types/racing";

interface DashboardProps {
  /** Parsed → session handoff. Files opened from any dashboard surface go
   *  through this so Index's session state stays authoritative. */
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  /** Open a session by its stored file name. Reuses Index's central open
   *  handler so the dashboard row-click and the file-manager drawer row-click
   *  go through the exact same load path. */
  onOpenFile: (fileName: string) => void;
  /** Open the garage drawer on its Vehicles tab (Garage tile + nav). */
  onOpenGarage: () => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
  /** Sample-file loader — demoted from a primary CTA to a small link in the
   *  empty state; still available for the fresh-install case. */
  onLoadSample: () => void;
  isLoadingSample: boolean;
  showSampleFiles: boolean;
  // Settings dialog is owned + rendered by Dashboard in controlled mode so
  // the nav bar's Settings destination can open it. That removes what used
  // to be a top-right gear button duplicating the same action.
  settings: AppSettings;
  onSettingsChange: (updates: Partial<AppSettings>) => void;
  onToggleFieldDefault: (canonicalId: CanonicalFieldId) => void;
  canHideSampleFiles: boolean;
}

/**
 * Dashboard — the app's home surface (rendered by Index when no session is
 * loaded). Three logical zones, top to bottom:
 *
 *   1. **Status row** — Sessions summary · Garage · Tracks. Each shows what's
 *      on the device (counts, stats, config) and clicks through to the
 *      corresponding manager. These are the "what do I have" cards.
 *   2. **Recent sessions** — the full clickable list. Returning-user primary
 *      target: pick up a session and go.
 *   3. **Add data** — Devices + Import. Actions that bring NEW data in,
 *      visually separated from the "view what I have" zone above.
 */
export function Dashboard({
  onDataLoaded,
  onOpenFile,
  onOpenGarage,
  autoSave,
  autoSaveFile,
  onLoadSample,
  isLoadingSample,
  showSampleFiles,
  settings,
  onSettingsChange,
  onToggleFieldDefault,
  canHideSampleFiles,
}: DashboardProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <AppShell
      actions={{
        onOpenGarage,
        onOpenTracks: () => setTracksOpen(true),
        // Tools opens the standalone calculators (Stance nosedive, Seat
        // Position CoG, Phone Lap Timer) in a dialog. They're all in the
        // in-session Tools tab too — this makes them reachable from the
        // dashboard when no session is loaded.
        onOpenTools: () => setToolsOpen(true),
        onOpenSettings: () => setSettingsOpen(true),
      }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick up where you left off, or add data from a file or device.
          </p>
        </div>

        {/* ── Status row: what's on this device ─────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SessionsSummaryTile />
          <GarageTile onManage={onOpenGarage} />
          {/* TracksTile is presentational; the click target is the wrapping
              button, which flips tracksOpen so TrackEditor's dialog renders
              through controlled mode. */}
          <button
            type="button"
            onClick={() => setTracksOpen(true)}
            className="text-left focus:outline-none"
          >
            <TracksTile />
          </button>
        </div>

        {/* ── The list ──────────────────────────────────────────────────── */}
        <RecentSessionsTile
          onOpen={onOpenFile}
          showSampleFiles={showSampleFiles}
          onLoadSample={onLoadSample}
          isLoadingSample={isLoadingSample}
        />

        {/* ── Add-data actions: separated from the "view" zone above ────── */}
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
            Add data
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <LoggerDownload
              onDataLoaded={onDataLoaded}
              autoSave={autoSave}
              autoSaveFile={autoSaveFile}
              renderTrigger={({ onOpen }) => <DevicesTile onOpen={onOpen} />}
            />
            <ImportTile
              onDataLoaded={onDataLoaded}
              autoSave={autoSave}
              autoSaveFile={autoSaveFile}
            />
          </div>
        </div>
      </div>

      {/* Track manager — controlled from the Tracks tile + nav destination.
          externalOpen puts TrackEditor in dialog-only mode (no inline UI). */}
      <TrackEditor
        externalOpen={tracksOpen}
        onExternalOpenChange={setTracksOpen}
      />

      {/* Settings modal — controlled from the nav bar's Settings destination.
          No trigger button; the nav item is the entry point. */}
      <SettingsModal
        settings={settings}
        onSettingsChange={onSettingsChange}
        onToggleFieldDefault={onToggleFieldDefault}
        canHideSampleFiles={canHideSampleFiles}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* Tools — the standalone calculators (Stance / Seat Position / Phone
          Lap Timer), same picker + bodies the in-session Tools tab uses. */}
      <ToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} />

      {/* Help row. These three dialogs used to hang off the landing page's
          SiteHeader, which the dashboard replaced — leaving the device list
          reachable from nowhere and About/Supported-files only on the
          cloud-gated Leaderboards and Driver pages, which a default build
          never mounts. The dashboard is the home surface now, so they live
          here. SupportedFilesDialog and AboutDialog render their own trigger;
          SupportedDevicesDialog takes one. */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-1 border-t border-border pt-4 text-muted-foreground">
        <SupportedDevicesDialog
          trigger={
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Supported devices
            </Button>
          }
        />
        <SupportedFilesDialog />
        <AboutDialog />
      </div>
    </AppShell>
  );
}

// Keep a default export for parity with the earlier preview route; can be
// removed once nothing else lazy-imports this file.
export default Dashboard;
