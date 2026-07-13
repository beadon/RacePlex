import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { FileImport } from "@/components/FileImport";
import { LoggerDownload } from "@/components/LoggerDownload";
import { TrackEditor } from "@/components/TrackEditor";
import { RecentSessionsTile } from "@/components/dashboard/RecentSessionsTile";
import { GarageTile } from "@/components/dashboard/GarageTile";
import { TracksTile } from "@/components/dashboard/TracksTile";
import { DevicesTile } from "@/components/dashboard/DevicesTile";
import { PluginMount } from "@/plugins/PluginMount";
import { MountSlot } from "@/plugins/mounts";
import type { ParsedData } from "@/types/racing";

interface DashboardProps {
  /** Parsed → session handoff. Files opened from any dashboard surface go
   *  through this so Index's session state stays authoritative. */
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  /** Open a session by its stored file name. Reuses Index's central open
   *  handler so the dashboard row-click and the file-manager drawer row-click
   *  go through the exact same load path. */
  onOpenFile: (fileName: string) => void;
  /** Open the garage drawer on its Vehicles tab (for the Garage tile). */
  onOpenGarage: () => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
  /** Settings modal (trigger + dialog), rendered in the shell's right cluster. */
  settingsButton: ReactNode;
  /** Sample-file loader — demoted from a primary CTA to a small link in the
   *  empty state; still available for the fresh-install case. */
  onLoadSample: () => void;
  isLoadingSample: boolean;
  showSampleFiles: boolean;
}

/**
 * Dashboard — the app's home surface (rendered by Index when no session is
 * loaded). Shows what's on the system (recent sessions, garage, tracks) and
 * offers inline entry points to add more (file import, device download, track
 * manager). Plugin-contributed Landing tiles (currently: Tools) show up
 * automatically via the PluginMount slot at the end of the grid.
 */
export function Dashboard({
  onDataLoaded,
  onOpenFile,
  onOpenGarage,
  autoSave,
  autoSaveFile,
  settingsButton,
  onLoadSample,
  isLoadingSample,
  showSampleFiles,
}: DashboardProps) {
  return (
    <AppShell rightSlot={settingsButton}>
      <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop a telemetry file, connect a device, or pick from your saved sessions.
          </p>
        </div>

        {/* Inline import dropzone — the primary "add data" surface. */}
        <FileImport
          onDataLoaded={onDataLoaded}
          autoSave={autoSave}
          autoSaveFile={autoSaveFile}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RecentSessionsTile onOpen={onOpenFile} showSampleFiles={showSampleFiles} />
          <GarageTile onManage={onOpenGarage} />

          {/* TrackEditor's dialog attaches to whatever we hand it as
              triggerButton — the TracksTile is the click target. */}
          <TrackEditor triggerButton={<TracksTile />} />

          {/* LoggerDownload owns the datalogger picker + BLE flow lazily. */}
          <LoggerDownload
            onDataLoaded={onDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
            renderTrigger={({ onOpen }) => <DevicesTile onOpen={onOpen} />}
          />

          {/* Plugin-contributed Landing tiles (Tools today; others later).
              Suspense because contributed components are React.lazy by convention. */}
          <Suspense fallback={null}>
            <PluginMount slot={MountSlot.Landing} ctx={{}} />
          </Suspense>
        </div>

        {/* Sample-file access — demoted from the hero to a tucked-away link.
            Kept for the fresh-install case where a user has nothing to open. */}
        {showSampleFiles && (
          <div className="pt-2 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={onLoadSample}
              disabled={isLoadingSample}
              className="underline hover:text-foreground disabled:opacity-50"
            >
              {isLoadingSample ? "Loading sample…" : "Load sample data"}
            </button>
            {" · never touches the network."}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Keep a default export for parity with the earlier preview route; can be
// removed once nothing else lazy-imports this file.
export default Dashboard;
