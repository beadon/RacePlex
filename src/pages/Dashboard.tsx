import { type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { LoggerDownload } from "@/components/LoggerDownload";
import { TrackEditor } from "@/components/TrackEditor";
import { RecentSessionsTile } from "@/components/dashboard/RecentSessionsTile";
import { GarageTile } from "@/components/dashboard/GarageTile";
import { TracksTile } from "@/components/dashboard/TracksTile";
import { DevicesTile } from "@/components/dashboard/DevicesTile";
import { ImportTile } from "@/components/dashboard/ImportTile";
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
 * loaded). Optimized for the *returning* user: Recent Sessions is the first
 * thing you see, and the quick-action row (Garage / Tracks / Devices /
 * Import) sits right below with equal weight — no single action dominates.
 *
 * Import in particular is a compact tile that opens the FileImport dropzone
 * in a dialog on click, rather than being the page's hero. First-time users
 * still get a "Load a sample RaceBox session" nudge inside Recent Sessions'
 * empty state.
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
    <AppShell
      rightSlot={settingsButton}
      actions={{
        onOpenGarage,
        // Tracks + Tools nav destinations to come — need an imperative-open
        // handle from TrackEditor and a Tools route, respectively. Omitting
        // for now hides those nav items rather than dead-ending them.
      }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick up where you left off, or add data from a file or device.
          </p>
        </div>

        {/* Returning-user flow: their sessions come first, at full width. */}
        <RecentSessionsTile
          onOpen={onOpenFile}
          showSampleFiles={showSampleFiles}
          onLoadSample={onLoadSample}
          isLoadingSample={isLoadingSample}
        />

        {/* Quick-actions row — equal-weight cards. Order optimizes for
            frequency: Garage/Tracks are edited more often than a fresh
            device connect or one-off import for a returning user. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

          <ImportTile
            onDataLoaded={onDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
          />
        </div>
      </div>
    </AppShell>
  );
}

// Keep a default export for parity with the earlier preview route; can be
// removed once nothing else lazy-imports this file.
export default Dashboard;
