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
import { buildLiveCaptureFileName, serializeLiveCapture } from "@/lib/live/liveCapturePackage";
import { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";
import { applyVescMergeToExtraFields, appendVescFieldMappings } from "@/lib/live/vescMergeFields";
import type { VescSetupValues } from "@/lib/live/vescDecoder";
import { useVescSidecar } from "@/hooks/useVescSidecar";
import { VescSidecarControl } from "@/components/VescSidecarControl";
import { applyBmsMergeToExtraFields, appendBmsFieldMappings } from "@/lib/live/bmsMergeFields";
import type { BmsSample } from "@/lib/live/bmsTransport";
import { useBmsSidecar } from "@/hooks/useBmsSidecar";
import { BmsSidecarControl } from "@/components/BmsSidecarControl";
import { useSidecarVehicleBinding } from "@/hooks/useSidecarVehicleBinding";
import { applyHeartRateMergeToExtraFields, appendHeartRateFieldMappings } from "@/lib/live/heartRateMergeFields";
import type { HeartRateSample } from "@/lib/live/heartRateDecoder";
import { useHeartRateSidecar } from "@/hooks/useHeartRateSidecar";
import { HeartRateSidecarControl } from "@/components/HeartRateSidecarControl";
import { isUserCancelledBluetoothPicker } from "@/lib/live/bleUtils";
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
 * discarded. On save, a `.rplive` package (plan 0015) lands in the file
 * manager and gets opened as the active session (same path as any other
 * import) — and, unlike the file manager's previous ad hoc JSON, it can be
 * reopened later too: `datalogParser.ts` has a real parser for it.
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

  // Optional second BLE connection (issue #58) — merges by receipt time, not
  // either device's own clock; see concurrentCapture.ts for why. A stable
  // object created once, so useState's lazy initializer (not useRef — its
  // value must never be read during render).
  const [merger] = useState(() => new ConcurrentSourceMerger<unknown, VescSetupValues>());
  const vesc = useVescSidecar(merger);
  // Third BLE connection (issue #73) — its own independent merger against
  // the same primary stream, folded into the same extraFields object right
  // after the VESC merge. Not a single N-way merger: two independent
  // primary+secondary pairings are simpler than generalizing
  // ConcurrentSourceMerger to more than one secondary.
  const [bmsMerger] = useState(() => new ConcurrentSourceMerger<unknown, BmsSample>());
  const bms = useBmsSidecar(bmsMerger);
  // Remembers a first-time-connected sidecar's device name on a Vehicle
  // profile so pairing is faster next session.
  useSidecarVehicleBinding(vesc, bms);
  // Fourth BLE connection (issue #87) — a heart-rate monitor belongs to the
  // rider, not the board, so it's never fed into useSidecarVehicleBinding;
  // it remembers its own last-used device separately (heartRateDevicePreference.ts).
  const [heartRateMerger] = useState(() => new ConcurrentSourceMerger<unknown, HeartRateSample>());
  const heartRate = useHeartRateSidecar(heartRateMerger);

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
    try { await vesc.disconnect(); } catch { /* ignore */ }
    try { await bms.disconnect(); } catch { /* ignore */ }
    try { await heartRate.disconnect(); } catch { /* ignore */ }
    // Only the disconnect functions (themselves useCallback-stable off their
    // mergers, which never change) are used here — depending on the whole
    // vesc/bms/heartRate objects, which are fresh literals every render,
    // would re-run this effect's cleanup+setup on every render, actively
    // tearing down BLE connections mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesc.disconnect, bms.disconnect, heartRate.disconnect]);

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
        const beforeCount = capture.snapshot().count;
        capture.append(sample);
        const snap = capture.snapshot();
        // append() can drop a sample (duplicate/non-increasing timestamp) —
        // only pair + mutate the sample that actually landed, matching by
        // "did the count move" rather than assuming a 1:1 call correspondence.
        if (snap.count > beforeCount) {
          const receivedAt = Date.now();
          const extraFields = snap.samples[snap.samples.length - 1].extraFields;
          applyVescMergeToExtraFields(extraFields, merger.addPrimary({ receivedAt, data: null }));
          applyBmsMergeToExtraFields(extraFields, bmsMerger.addPrimary({ receivedAt, data: null }));
          applyHeartRateMergeToExtraFields(extraFields, heartRateMerger.addPrimary({ receivedAt, data: null }));
        }
        setSampleCount(snap.count);
        setLatest({ speedKph: sample.speedMps * 3.6, nSat: sample.numSV });
      });
      setPhase("recording");
      setStatus(`Recording from ${conn.name}`);
    } catch (e) {
      // Dismissing the browser's own device picker isn't a failure — just
      // let the rider try again from idle instead of showing an error.
      if (isUserCancelledBluetoothPicker(e)) {
        setPhase("idle");
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setPhase("error");
      setError(msg);
    }
  }, [merger, bmsMerger, heartRateMerger]);

  const handleSave = useCallback(async () => {
    if (!captureRef.current) return;
    setPhase("ending");
    setStatus("Saving session…");
    const deviceName = connectionRef.current?.name;
    try {
      await teardown();
      const capture = captureRef.current;
      const data = capture.toParsedData();
      appendVescFieldMappings(data.fieldMappings, data.samples);
      appendBmsFieldMappings(data.fieldMappings, data.samples);
      appendHeartRateFieldMappings(data.fieldMappings, data.samples);
      const start = capture.snapshot().startDate ?? new Date();
      const source = { kind: "racebox" as const, deviceName };
      const fileName = buildLiveCaptureFileName(source, start);

      await saveFile(fileName, serializeLiveCapture(data, source));
      await saveFileMetadata({
        fileName,
        trackName: "",
        courseName: "",
        sessionStartTime: start.getTime(),
        source: "device",
        hasVescData: merger.hasSecondary,
        hasBmsData: bmsMerger.hasSecondary,
        hasHeartRateData: heartRateMerger.hasSecondary,
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
  }, [teardown, onDataLoaded, merger, bmsMerger, heartRateMerger]);

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
              {/* Optional second/third/fourth BLE connections alongside this
                  one (issues #58, #73, #87) — each merged by receipt time,
                  flagged suspect when stale. */}
              <div className="border-t border-border pt-2 space-y-2">
                <VescSidecarControl vesc={vesc} />
                <BmsSidecarControl bms={bms} />
                <HeartRateSidecarControl heartRate={heartRate} />
              </div>
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
