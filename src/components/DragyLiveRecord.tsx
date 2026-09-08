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
import type { DragyConnection } from "@/lib/live/dragyTransport";
import type { DragySample } from "@/lib/live/dragyDecoder";
import type { FieldMapping, GpsSample, ParsedData } from "@/types/racing";
import { calculateBounds, speedTriple } from "@/lib/parserUtils";
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

interface DragyLiveRecordProps {
  open: boolean;
  onClose: () => void;
  onDataLoaded?: (data: ParsedData, fileName: string) => void;
}

type Phase = "idle" | "connecting" | "recording" | "ending" | "saved" | "error";

/**
 * Live-record from a Dragy over Web Bluetooth. Mirrors `RaceBoxLiveRecord`
 * one-for-one but drives the Dragy transport (which does its own handshake
 * dance before subscribing — see `dragyTransport.ts`). The sample stream is
 * slimmer than RaceBox's (no g-force, no rotation), so we buffer it inline
 * here rather than reusing `RaceBoxCapture`.
 */
export function DragyLiveRecord({ open, onClose, onDataLoaded }: DragyLiveRecordProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [latest, setLatest] = useState<{ speedKph: number; nSat: number } | null>(null);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);

  const connectionRef = useRef<DragyConnection | null>(null);
  const samplesRef = useRef<GpsSample[]>([]);
  const t0Ref = useRef<number | undefined>(undefined);
  const startDateRef = useRef<Date | undefined>(undefined);
  const subUnsubRef = useRef<(() => void) | null>(null);

  // Optional second BLE connection (issue #58) — merges by receipt time, not
  // either device's own clock; see concurrentCapture.ts for why.
  // A stable object created once, so useState's lazy initializer (not
  // useRef — its value must never be read during render).
  const [merger] = useState(() => new ConcurrentSourceMerger<unknown, VescSetupValues>());
  const vesc = useVescSidecar(merger);
  // Third BLE connection (issue #73) — its own independent merger against
  // the same primary stream, folded into the same extraFields object right
  // after the VESC merge.
  const [bmsMerger] = useState(() => new ConcurrentSourceMerger<unknown, BmsSample>());
  const bms = useBmsSidecar(bmsMerger);
  // Remembers a first-time-connected sidecar's device name on a Vehicle
  // profile so pairing is faster next session.
  useSidecarVehicleBinding(vesc, bms);
  // Fourth BLE connection (issue #87) — a heart-rate monitor belongs to the
  // rider, not the board, so it's never fed into useSidecarVehicleBinding.
  const [heartRateMerger] = useState(() => new ConcurrentSourceMerger<unknown, HeartRateSample>());
  const heartRate = useHeartRateSidecar(heartRateMerger);

  const reset = useCallback(() => {
    setPhase("idle");
    setStatus("");
    setError(null);
    setSampleCount(0);
    setLatest(null);
    setSavedFileName(null);
    samplesRef.current = [];
    t0Ref.current = undefined;
    startDateRef.current = undefined;
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

  useEffect(() => {
    if (!open) return;
    return () => { void teardown(); };
  }, [open, teardown]);

  const handleCancel = useCallback(async () => {
    await teardown();
    reset();
    onClose();
  }, [teardown, reset, onClose]);

  const appendSample = useCallback((sample: DragySample) => {
    const utcMs = Date.UTC(
      sample.year, sample.month - 1, sample.day,
      sample.hour, sample.minute, sample.second,
      Math.round(sample.nanoseconds / 1_000_000),
    );
    if (!Number.isFinite(utcMs)) return;
    if (t0Ref.current === undefined) {
      t0Ref.current = utcMs;
      startDateRef.current = new Date(utcMs);
    }
    const t = utcMs - t0Ref.current;
    const list = samplesRef.current;
    if (list.length > 0 && !(t > list[list.length - 1].t)) return;

    const extraFields: Record<string, number> = {
      "Altitude (m)": sample.altitudeM,
      "GPS Accuracy (m)": sample.hAccM,
      Satellites: sample.numSV,
      HDOP: sample.pDOP,
    };
    const receivedAt = Date.now();
    applyVescMergeToExtraFields(extraFields, merger.addPrimary({ receivedAt, data: null }));
    applyBmsMergeToExtraFields(extraFields, bmsMerger.addPrimary({ receivedAt, data: null }));
    applyHeartRateMergeToExtraFields(extraFields, heartRateMerger.addPrimary({ receivedAt, data: null }));

    list.push({
      t,
      lat: sample.latitude,
      lon: sample.longitude,
      ...speedTriple(sample.speedMps),
      heading: sample.headingDeg,
      extraFields,
    });
    setSampleCount(list.length);
    setLatest({ speedKph: sample.speedMps * 3.6, nSat: sample.numSV });
  }, [merger, bmsMerger, heartRateMerger]);

  const handleConnect = useCallback(async () => {
    setPhase("connecting");
    setError(null);
    setStatus("Waiting for you to pick your Dragy…");
    try {
      const { connectDragyLive } = await import("@/lib/live/dragyTransport");
      const conn = await connectDragyLive();
      connectionRef.current = conn;
      subUnsubRef.current = conn.subscribeToSamples(appendSample);
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
  }, [appendSample]);

  const handleSave = useCallback(async () => {
    if (samplesRef.current.length === 0) return;
    setPhase("ending");
    setStatus("Saving session…");
    const deviceName = connectionRef.current?.name;
    try {
      await teardown();
      const samples = samplesRef.current;
      const start = startDateRef.current ?? new Date();
      const fieldMappings: FieldMapping[] = [
        { index: -1, name: "Speed", enabled: true },
        { index: -2, name: "Altitude (m)", enabled: true },
        { index: -3, name: "GPS Accuracy (m)", enabled: false },
        { index: -4, name: "Satellites", enabled: false },
        { index: -5, name: "HDOP", enabled: false },
      ];
      appendVescFieldMappings(fieldMappings, samples);
      appendBmsFieldMappings(fieldMappings, samples);
      appendHeartRateFieldMappings(fieldMappings, samples);
      const data: ParsedData = {
        samples,
        fieldMappings,
        bounds: calculateBounds(samples),
        duration: samples[samples.length - 1]?.t ?? 0,
        startDate: start,
      };
      const source = { kind: "dragy" as const, deviceName };
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
            Dragy live recorder
          </DialogTitle>
          <DialogDescription>
            Live-record a session from a Dragy over Bluetooth. Needs Chrome or
            Edge on desktop or Android. The Dragy protocol is reverse-engineered
            and firmware-dependent — the handshake may change without notice.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          {phase === "idle" && (
            <p className="text-muted-foreground">
              Turn the Dragy on, then click Connect to pick it in the browser's
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
