import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bluetooth, Loader2, Radio, Save, StopCircle } from "lucide-react";
import { saveFile, saveFileMetadata } from "@/lib/fileStorage";
import type { RaceBoxConnection } from "@/lib/live/raceboxTransport";
import { RaceBoxCapture } from "@/lib/live/raceboxSession";
import type { ParsedData } from "@/types/racing";

interface RaceBoxLiveRecordProps {
  open: boolean;
  onClose: () => void;
  /** Hand the finished capture into the app's session state. */
  onDataLoaded?: (data: ParsedData, fileName: string) => void;
}

type Phase = "idle" | "connecting" | "recording" | "ending" | "saved" | "error";

/**
 * Live-record from a RaceBox over Web Bluetooth. The picker mounts this on
 * demand; when the rider closes the dialog before saving, the capture is
 * discarded. On save, a `.raceboxjson` file lands in the file manager and
 * gets opened as the active session (same path as any other import).
 *
 * NOTE the file format: we save the raw sample stream as JSON rather than
 * emitting a well-known logger format. It's the only shape that round-trips
 * without loss (the app doesn't parse `.raceboxjson` on reopen yet — future
 * slice). Users get their session live in the viewer; the file exists so a
 * refresh doesn't lose it.
 */
export function RaceBoxLiveRecord({ open, onClose, onDataLoaded }: RaceBoxLiveRecordProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [latest, setLatest] = useState<{ speedKph: number; nSat: number } | null>(null);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);

  const connectionRef = useRef<RaceBoxConnection | null>(null);
  const captureRef = useRef<RaceBoxCapture | null>(null);
  const subUnsubRef = useRef<(() => void) | null>(null);

  // Reset all local state when the dialog closes so a follow-up open is fresh.
  const reset = useCallback(() => {
    setPhase("idle");
    setStatus("");
    setError(null);
    setSampleCount(0);
    setLatest(null);
    setSavedFileName(null);
    captureRef.current = null;
  }, []);

  const teardown = useCallback(async () => {
    try { subUnsubRef.current?.(); } catch { /* ignore */ }
    subUnsubRef.current = null;
    try { await connectionRef.current?.disconnect(); } catch { /* ignore */ }
    connectionRef.current = null;
  }, []);

  // A late unmount (browser back button, dialog kill) must still release BLE
  // — leaking a paired GATT server keeps the device unreachable to the next
  // page load.
  useEffect(() => {
    if (!open) return;
    return () => { void teardown(); };
  }, [open, teardown]);

  const handleCancel = useCallback(async () => {
    await teardown();
    reset();
    onClose();
  }, [teardown, reset, onClose]);

  const handleConnect = useCallback(async () => {
    setPhase("connecting");
    setError(null);
    setStatus("Waiting for you to pick your RaceBox…");
    try {
      const { connectRaceBoxLive } = await import("@/lib/live/raceboxTransport");
      const conn = await connectRaceBoxLive();
      connectionRef.current = conn;
      const capture = new RaceBoxCapture();
      captureRef.current = capture;
      subUnsubRef.current = conn.subscribeToSamples((sample) => {
        capture.append(sample);
        const snap = capture.snapshot();
        setSampleCount(snap.count);
        setLatest({ speedKph: sample.speedMps * 3.6, nSat: sample.numSV });
      });
      setPhase("recording");
      setStatus(`Recording from ${conn.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase("error");
      setError(msg);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!captureRef.current) return;
    setPhase("ending");
    setStatus("Saving session…");
    try {
      await teardown();
      const capture = captureRef.current;
      const data = capture.toParsedData();
      const start = capture.snapshot().startDate ?? new Date();
      const stamp = start.toISOString().replace(/[:.]/g, "-");
      const fileName = `racebox-${stamp}.raceboxjson`;

      // Persist the raw sample stream so the file manager has a real blob
      // to point at. A future slice will register a parser for
      // `.raceboxjson`; for now the file exists for the auto-save round-trip
      // (delete + reimport works even though it re-parses as generic CSV
      // and fails cleanly) and the ParsedData feeds the session directly.
      await saveFile(fileName, new Blob(
        [JSON.stringify({ samples: data.samples, startDate: start.toISOString() })],
        { type: "application/json" },
      ));
      await saveFileMetadata({
        fileName,
        trackName: "",
        courseName: "",
        sessionStartTime: start.getTime(),
        source: "device",
      });
      setSavedFileName(fileName);
      setPhase("saved");
      setStatus("Saved");
      onDataLoaded?.(data, fileName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase("error");
      setError(msg);
    }
  }, [teardown, onDataLoaded]);

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? void handleCancel() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            RaceBox live recorder
          </DialogTitle>
          <DialogDescription>
            Live-record a session from a RaceBox Mini / Micro over Bluetooth.
            Needs Chrome or Edge on desktop or Android — Web Bluetooth isn't
            available on iOS.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          {phase === "idle" && (
            <p className="text-muted-foreground">
              Turn the RaceBox on, then click Connect to pick it in the browser's
              Bluetooth picker.
            </p>
          )}
          {phase === "connecting" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status}
            </p>
          )}
          {phase === "recording" && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-foreground font-medium">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                Recording · {sampleCount.toLocaleString()} samples
              </p>
              {latest && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Speed {latest.speedKph.toFixed(1)} km/h · {latest.nSat} sats
                </p>
              )}
            </div>
          )}
          {phase === "ending" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status}
            </p>
          )}
          {phase === "saved" && (
            <div>
              <p className="text-sm text-foreground">Saved as</p>
              <p className="text-xs font-mono text-muted-foreground break-all">{savedFileName}</p>
            </div>
          )}
          {phase === "error" && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {phase === "idle" && (
            <>
              <Button variant="outline" onClick={handleCancel}>Cancel</Button>
              <Button onClick={() => void handleConnect()} className="gap-1.5">
                <Bluetooth className="w-4 h-4" /> Connect
              </Button>
            </>
          )}
          {phase === "recording" && (
            <>
              <Button variant="outline" onClick={handleCancel}>Discard</Button>
              <Button variant="destructive" onClick={() => void handleSave()} className="gap-1.5">
                <StopCircle className="w-4 h-4" /> Stop &amp; save
              </Button>
            </>
          )}
          {phase === "saved" && (
            <Button onClick={() => { reset(); onClose(); }} className="gap-1.5">
              <Save className="w-4 h-4" /> Close
            </Button>
          )}
          {phase === "error" && (
            <Button variant="outline" onClick={handleCancel}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
