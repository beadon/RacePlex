import { useCallback } from "react";
import { FileText, MapPin } from "lucide-react";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import {
  listFiles,
  listAllMetadata,
  type FileEntry,
  type FileMetadata,
} from "@/lib/fileStorage";
import { isSampleFileName } from "@/lib/sampleData";
import { useAsyncSnapshot } from "@/hooks/useAsyncSnapshot";
import { cn } from "@/lib/utils";

/** How many recent sessions the dashboard tile shows. Anything beyond this is
 *  reachable via the file-manager drawer (Garage → Files). */
const RECENT_LIMIT = 6;

interface RecentSessionsTileProps {
  onOpen: (fileName: string) => void;
  /** When false, hide the bundled sample so the tile doesn't advertise it. */
  showSampleFiles: boolean;
  /** Fires the "seed the sample file into IndexedDB and open it" flow. Shown
   *  as an inline option only when the tile is empty AND showSampleFiles is on
   *  — a fresh install should have a way to try the app without hunting. */
  onLoadSample: () => void;
  isLoadingSample: boolean;
}

interface RecentSession {
  fileName: string;
  displayName: string;
  trackLabel: string | null;
  savedAt: number;
  isSample: boolean;
}

interface RecentSessionsSnapshot {
  items: RecentSession[];
  loaded: boolean;
}

const EMPTY: RecentSessionsSnapshot = { items: [], loaded: false };

function pickDisplayName(entry: FileEntry, meta: FileMetadata | undefined): string {
  if (meta?.displayName) return meta.displayName;
  if (meta?.sessionStartTime) {
    return new Date(meta.sessionStartTime).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
  // Fall back to the file name minus a trailing extension so the row stays
  // scannable — the raw name with `.csv` on the end reads noisily.
  return entry.name.replace(/\.[^.]+$/, "");
}

function pickTrackLabel(meta: FileMetadata | undefined): string | null {
  if (!meta?.trackName) return null;
  if (meta.courseName) return `${meta.trackName} · ${meta.courseName}`;
  return meta.trackName;
}

async function loadRecentSessions(): Promise<RecentSessionsSnapshot> {
  const [files, allMeta] = await Promise.all([listFiles(), listAllMetadata()]);
  const metaByName = new Map(allMeta.map((m) => [m.fileName, m]));
  const items: RecentSession[] = files
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, RECENT_LIMIT * 2) // over-fetch a bit so the sample-filter doesn't strand us
    .map((entry) => {
      const meta = metaByName.get(entry.name);
      return {
        fileName: entry.name,
        displayName: pickDisplayName(entry, meta),
        trackLabel: pickTrackLabel(meta),
        savedAt: entry.savedAt,
        isSample: !!meta?.isSample || isSampleFileName(entry.name),
      };
    });
  return { items, loaded: true };
}

function subscribeFilesAndMetadata(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.FILES || c.store === STORE_NAMES.METADATA) onChange();
  });
}

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 60 * 60_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.round(diffMs / (60 * 60_000))}h ago`;
  if (diffMs < 7 * day) return `${Math.round(diffMs / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function RecentSessionsTile({
  onOpen,
  showSampleFiles,
  onLoadSample,
  isLoadingSample,
}: RecentSessionsTileProps) {
  const { data } = useAsyncSnapshot({
    key: "dashboard:recent-sessions",
    initial: EMPTY,
    load: loadRecentSessions,
    subscribe: subscribeFilesAndMetadata,
  });

  const visible = useCallback(() => {
    const filtered = showSampleFiles ? data.items : data.items.filter((s) => !s.isSample);
    return filtered.slice(0, RECENT_LIMIT);
  }, [data.items, showSampleFiles])();

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden sm:col-span-2 lg:col-span-3">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          Recent sessions
        </h2>
        {data.loaded && visible.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {visible.length} shown
          </span>
        )}
      </div>

      {!data.loaded ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground space-y-2">
          <p>No sessions yet. Drop a telemetry file above to start.</p>
          {showSampleFiles && (
            <p className="text-xs">
              First time here?{" "}
              <button
                type="button"
                onClick={onLoadSample}
                disabled={isLoadingSample}
                className="underline hover:text-foreground disabled:opacity-50"
              >
                {isLoadingSample ? "Loading sample…" : "Load a sample RaceBox session"}
              </button>
              {" to explore the tool."}
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((s) => (
            <li key={s.fileName}>
              <button
                type="button"
                onClick={() => onOpen(s.fileName)}
                className={cn(
                  "w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {s.displayName}
                    </span>
                    {s.isSample && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        sample
                      </span>
                    )}
                  </div>
                  {s.trackLabel && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {s.trackLabel}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(s.savedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
