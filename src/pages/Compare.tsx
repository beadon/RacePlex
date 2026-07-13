import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GitCompare, X, Loader2, ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { parseDatalogFile } from "@/lib/datalogParser";
import { getFile } from "@/lib/fileStorage";
import { autoDetectCourse } from "@/lib/courseDetection";
import { loadTracks } from "@/lib/trackStorage";
import type { Lap, ParsedData } from "@/types/racing";
import { alignSessionToLap, unionChannelIds, type AlignedSeries } from "@/lib/comparison/align";
import { ComparisonChart } from "@/components/comparison/ComparisonChart";
import { ComparisonMap } from "@/components/comparison/ComparisonMap";
import { ComparisonSessionBar } from "@/components/comparison/ComparisonSessionBar";

/**
 * `/compare` — cross-session comparison view (plan 0012 / issue #37).
 *
 * Reads its inputs from `location.state.compareFileNames`, an array of file
 * names the RecentSessionsTile (or file-manager drawer) staged. A bare
 * `/compare` visit has nothing to show — we bounce back to the dashboard.
 *
 * The page loads + parses each file in parallel, picks the fastest lap of
 * each by default, re-samples every lap by distance, and stacks per-channel
 * charts underneath a session bar for lap-picking / removal.
 */

type SessionRecord =
  | { fileName: string; status: "loading" }
  | { fileName: string; status: "error"; error: string }
  | { fileName: string; status: "ready"; data: ParsedData; laps: Lap[]; selectedLap: Lap | null };

interface LocationState {
  compareFileNames?: string[];
}

/** Stable, colour-blind-friendly palette for up to 8 sessions. Beyond that
 *  we wrap; a comparison of more than 8 sessions is unusual. */
const PALETTE = [
  "hsl(0 76% 55%)",     // Racing Red (brand)
  "hsl(210 90% 55%)",   // Blue
  "hsl(160 60% 42%)",   // Teal
  "hsl(280 60% 55%)",   // Violet
  "hsl(30 90% 55%)",    // Orange
  "hsl(50 90% 45%)",    // Yellow-green
  "hsl(340 80% 55%)",   // Pink
  "hsl(120 45% 45%)",   // Green
];

export default function Compare() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const requested = useMemo(() => state?.compareFileNames ?? [], [state?.compareFileNames]);

  // If a rider lands on /compare cold (deep link, browser back), there's no
  // selection to show — bounce back to the dashboard.
  useEffect(() => {
    if (requested.length < 2) {
      navigate("/", { replace: true });
    }
  }, [requested.length, navigate]);

  const [sessions, setSessions] = useState<SessionRecord[]>(() =>
    requested.map((fileName) => ({ fileName, status: "loading" as const })),
  );

  // Load each requested file in parallel. Guard against a stale run — the
  // rider can rearrange the bin + come back; a second effect must not clobber
  // the first's state.
  const runIdRef = useRef(0);
  useEffect(() => {
    if (requested.length < 2) return;
    const runId = ++runIdRef.current;

    (async () => {
      const tracks = await loadTracks().catch(() => []);
      await Promise.all(requested.map(async (fileName) => {
        try {
          const blob = await getFile(fileName);
          if (!blob) throw new Error("File not found in storage");
          const data = await parseDatalogFile(new File([blob], fileName));
          const detection = autoDetectCourse(data.samples, tracks);
          const laps = detection?.laps ?? [];
          const selectedLap = laps.length > 0
            ? laps.reduce((best, l) => (l.lapTimeMs < best.lapTimeMs ? l : best))
            : null;
          if (runId !== runIdRef.current) return;
          setSessions((prev) => prev.map((s) => s.fileName === fileName
            ? { fileName, status: "ready" as const, data, laps, selectedLap }
            : s,
          ));
        } catch (e) {
          if (runId !== runIdRef.current) return;
          const err = e instanceof Error ? e.message : String(e);
          setSessions((prev) => prev.map((s) => s.fileName === fileName
            ? { fileName, status: "error" as const, error: err }
            : s,
          ));
        }
      }));
    })();
  }, [requested]);

  const remove = useCallback((fileName: string) => {
    setSessions((prev) => prev.filter((s) => s.fileName !== fileName));
  }, []);

  const setLap = useCallback((fileName: string, lap: Lap | null) => {
    setSessions((prev) => prev.map((s) => (
      s.status === "ready" && s.fileName === fileName ? { ...s, selectedLap: lap } : s
    )));
  }, []);

  const readySeries: AlignedSeries[] = useMemo(() => {
    const out: AlignedSeries[] = [];
    for (const s of sessions) {
      if (s.status !== "ready") continue;
      const aligned = alignSessionToLap(s.fileName, s.data, s.laps, s.selectedLap);
      if (aligned) out.push(aligned);
    }
    return out;
  }, [sessions]);

  const channelIds = useMemo(() => unionChannelIds(readySeries), [readySeries]);

  const [enabledChannels, setEnabledChannels] = useState<Set<string>>(new Set(["speedMps"]));
  const toggleChannel = useCallback((id: string) => {
    setEnabledChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const colourFor = useCallback((fileName: string) => {
    const idx = requested.indexOf(fileName);
    return PALETTE[Math.max(0, idx) % PALETTE.length];
  }, [requested]);

  // Slim view-model for the map — one entry per ready session that has a
  // selected lap. Keeps the map component from having to know about the
  // loading / error record shapes.
  const mapSessions = useMemo(() => (
    sessions
      .filter((s): s is Extract<SessionRecord, { status: "ready" }> => s.status === "ready")
      .map((s) => ({ fileName: s.fileName, samples: s.data.samples, lap: s.selectedLap }))
  ), [sessions]);

  const loading = sessions.some((s) => s.status === "loading");
  const readyCount = sessions.filter((s) => s.status === "ready").length;
  const errorCount = sessions.filter((s) => s.status === "error").length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <GitCompare className="w-6 h-6 text-primary" />
              Compare sessions
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {loading
              ? `Loading ${readyCount}/${sessions.length}…`
              : `${readyCount} session${readyCount === 1 ? "" : "s"}${errorCount ? ` · ${errorCount} failed` : ""}`}
          </p>
        </div>

        {/* Session list — one row per staged session, with its picked lap and a remove button. */}
        <ComparisonSessionBar
          sessions={sessions}
          onRemove={remove}
          onLapChange={setLap}
          colourFor={colourFor}
        />

        {/* Shared map — one polyline per session's selected lap, coloured
            to match its chart series. Deliberately no drift alignment; the
            charts compare by cumulative distance which doesn't care about
            small GPS offsets between different loggers. */}
        {mapSessions.some((s) => s.lap) && (
          <ComparisonMap sessions={mapSessions} colourFor={colourFor} />
        )}

        {/* Channel toggles — one per union'd channel id. Speed is default-on. */}
        {channelIds.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
            <span className="text-xs text-muted-foreground shrink-0">Channels:</span>
            {channelIds.map((id) => (
              <label key={id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs cursor-pointer hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={enabledChannels.has(id)}
                  onChange={() => toggleChannel(id)}
                  className="h-3 w-3 accent-primary cursor-pointer"
                />
                <span>{id}</span>
              </label>
            ))}
          </div>
        )}

        {/* Stacked charts — one per enabled channel, sessions overlaid as coloured series. */}
        <div className="space-y-3">
          {readySeries.length === 0 && !loading ? (
            <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No sessions to plot yet. Add sessions from the dashboard.
            </div>
          ) : loading && readySeries.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading sessions…
            </div>
          ) : (
            channelIds
              .filter((id) => enabledChannels.has(id))
              .map((id) => (
                <ComparisonChart
                  key={id}
                  channelId={id}
                  series={readySeries}
                  colourFor={colourFor}
                />
              ))
          )}
        </div>

        {/* Errors surface at the bottom so they don't push the useful content down. */}
        {sessions.some((s) => s.status === "error") && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
            {sessions.filter((s): s is Extract<SessionRecord, { status: "error" }> => s.status === "error").map((s) => (
              <div key={s.fileName} className="flex items-center gap-2">
                <span className="font-mono">{s.fileName}</span>
                <span>—</span>
                <span>{s.error}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto" onClick={() => remove(s.fileName)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
