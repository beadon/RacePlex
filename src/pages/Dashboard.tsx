import { type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { FileImport } from "@/components/FileImport";
import type { ParsedData } from "@/types/racing";

interface DashboardProps {
  /** Parsed → session handoff. Files opened from any dashboard surface go
   *  through this so Index's session state stays authoritative. */
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
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
 * loaded). Replaces the previous welcome-page flow: no hero, no marketing;
 * shows the user what's already on the system and gives an inline import
 * dropzone. Real content tiles (recent sessions, garage, tracks, devices)
 * land in follow-up commits.
 */
export function Dashboard({
  onDataLoaded,
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

        {/* Inline import dropzone — the primary "add data" surface. Kept
            simple until the tile grid lands. */}
        <FileImport
          onDataLoaded={onDataLoaded}
          autoSave={autoSave}
          autoSaveFile={autoSaveFile}
        />

        {/* Placeholder tiles — will become Recent sessions, Garage, Tracks,
            Devices, Tools in follow-ups. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["Recent sessions", "Garage", "Tracks", "Devices", "Tools"].map((label) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-card/50 p-4 min-h-32 flex items-center justify-center"
            >
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
          ))}
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

// Keep a default export so App.tsx's lazy() preview route keeps resolving
// during the transition. Removed once the preview route is dropped.
export default Dashboard;
