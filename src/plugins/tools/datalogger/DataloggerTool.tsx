/**
 * Phone Datalogger tool — live GPS lap timing using the phone as the logger.
 *
 * PHASE 1 UI: deliberately rough — a live map plus the key readouts (speed,
 * delta, current/best lap). The capture + timing engine is the real foundation
 * (`@/lib/gps`, `useDatalogger`); the visual design gets tuned in a later phase.
 *
 * Behavior: starts capturing the moment it opens, begins recording above 5 mph,
 * auto-ends after 5 min stopped, and saves a `.dovep` log to IndexedDB on end
 * (openable + processable like any uploaded session). A red control ends the
 * session manually after a confirm.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Satellite, Square, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { PluginPanelProps } from "@/plugins/panels";
import { formatLapTime } from "@/lib/lapCalculation";
import { useDatalogger } from "./useDatalogger";

function fmtLap(ms: number | null): string {
  return ms != null ? formatLapTime(ms) : "—:—";
}

function fmtDelta(sec: number | null): string {
  if (sec == null) return "—";
  const s = sec >= 0 ? "+" : "−";
  return `${s}${Math.abs(sec).toFixed(2)}`;
}

export default function DataloggerTool(props: PluginPanelProps) {
  const { phase, timing, latest, recordedCount, savedFileName, error, endSession } = useDatalogger();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const useKph = props.useKph;
  const speedMps = latest?.motion.speedMps ?? 0;
  const speed = useKph ? speedMps * 3.6 : speedMps * 2.236936;
  const speedUnit = useKph ? "km/h" : "mph";

  // --- Leaflet live map ---
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const lastSeqRef = useRef<number>(-1);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false }).setView([0, 0], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 22 }).addTo(map);
    trailRef.current = L.polyline([], { color: "#38bdf8", weight: 3 }).addTo(map);
    markerRef.current = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 2, fillColor: "#22c55e", fillOpacity: 1 }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!latest || !mapRef.current) return;
    const ll: L.LatLngExpression = [latest.fix.lat, latest.fix.lon];
    markerRef.current?.setLatLng(ll);
    // Only extend the trail with genuinely new fixes.
    if (latest.fix.seq !== lastSeqRef.current) {
      lastSeqRef.current = latest.fix.seq;
      if (phase === "recording") trailRef.current?.addLatLng(ll);
    }
    mapRef.current.setView(ll, Math.max(mapRef.current.getZoom(), 17));
  }, [latest, phase]);

  const delta = timing.deltaSec;
  const deltaColor = delta == null ? "text-muted-foreground" : delta > 0 ? "text-red-500" : "text-green-500";

  const statusLabel =
    phase === "waiting" ? "Waiting — drive above 5 mph to start"
    : phase === "recording" ? "Recording"
    : "Session ended";

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top status bar */}
      <div className="absolute top-0 inset-x-0 z-[1000] flex items-center justify-between gap-2 px-3 py-2 bg-background/80 backdrop-blur border-b border-border">
        <div className="flex items-center gap-2 text-sm">
          <Satellite className="w-4 h-4 text-primary" />
          <span className="font-medium">{timing.trackName ?? "Phone Datalogger"}</span>
          {timing.courseName && <span className="text-muted-foreground">· {timing.courseName}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${phase === "recording" ? "text-red-500" : "text-muted-foreground"}`}>
            {phase === "recording" && <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle animate-pulse" />}
            {statusLabel}
          </span>
          {phase !== "ended" && (
            <Button variant="destructive" size="sm" className="h-8 gap-1" onClick={() => setConfirmOpen(true)}>
              <Square className="w-3.5 h-3.5" /> End
            </Button>
          )}
        </div>
      </div>

      {/* Readouts */}
      <div className="absolute bottom-0 inset-x-0 z-[1000] grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/60 border-t border-border">
        <Readout label="Speed" value={speed.toFixed(0)} unit={speedUnit} />
        <Readout label="Delta" value={fmtDelta(delta)} unit="s" className={deltaColor} />
        <Readout label="Current" value={fmtLap(timing.currentLapMs)} />
        <Readout label="Best" value={fmtLap(timing.bestLapMs)} />
        <Readout label="Last" value={fmtLap(timing.lastLapMs)} />
        <Readout label="Optimal" value={fmtLap(timing.optimalMs)} />
        <Readout label="Laps" value={String(timing.lapCount)} />
        <Readout label="Logged" value={String(recordedCount)} unit="pts" />
      </div>

      {error && (
        <div className="absolute top-12 inset-x-3 z-[1001] rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Ended overlay */}
      {phase === "ended" && (
        <div className="absolute inset-0 z-[1002] flex items-center justify-center bg-background/80 backdrop-blur">
          <div className="max-w-sm space-y-3 text-center px-6">
            {savedFileName ? (
              <>
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
                <p className="text-sm font-medium text-foreground">Session saved</p>
                <p className="text-xs text-muted-foreground break-all">{savedFileName}</p>
                <p className="text-xs text-muted-foreground">Find it in your saved files to review like any log.</p>
              </>
            ) : (
              <>
                <Loader2 className="mx-auto h-10 w-10 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">{recordedCount > 0 ? "Saving session…" : "No data was recorded this session."}</p>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End session?</DialogTitle>
            <DialogDescription>
              This stops logging and saves the session to your files. You can't add more to it afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setConfirmOpen(false); void endSession(); }}>
              End session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Readout({ label, value, unit, className }: { label: string; value: string; unit?: string; className?: string }) {
  return (
    <div className="bg-background/85 backdrop-blur px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-lg font-semibold leading-tight ${className ?? "text-foreground"}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
