/**
 * Thin React adapter over `LapTimerSession`. The lifecycle/persistence logic
 * lives in the (unit-tested) controller; this hook just instantiates it with the
 * real browser dependencies (geolocation source, lap timer, IndexedDB save fns),
 * loads tracks, and re-renders on snapshot changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CustomGps, RealtimeLapTimer } from "@/lib/gps";
import { loadTracks } from "@/lib/trackStorage";
import { saveFile, saveFileMetadata } from "@/lib/fileStorage";
import { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";
import type { VescSetupValues } from "@/lib/live/vescDecoder";
import type { BmsSample } from "@/lib/live/bmsTransport";
import { useVescSidecar, type VescSidecarController } from "@/hooks/useVescSidecar";
import { useBmsSidecar, type BmsSidecarController } from "@/hooks/useBmsSidecar";
import {
  LapTimerSession,
  INITIAL_SNAPSHOT,
  type LapTimerSnapshot,
} from "./lapTimerSession";

export interface LapTimerController extends LapTimerSnapshot {
  /** Manually end + save the session (red "End" action). */
  endSession: () => Promise<void>;
  /** Discard the ended session and start a fresh capture. */
  reset: () => void;
  /** Optional VESC sidecar (issue #58) — same connect/status pattern as RaceBoxLiveRecord. */
  vesc: VescSidecarController;
  /** Optional BMS sidecar (issue #73) — same connect/status pattern as RaceBoxLiveRecord. */
  bms: BmsSidecarController;
}

export function useLapTimer(): LapTimerController {
  const [snapshot, setSnapshot] = useState<LapTimerSnapshot>(INITIAL_SNAPSHOT);
  const sessionRef = useRef<LapTimerSession | null>(null);

  // Stable across the tool's lifetime (useState's lazy initializer, not
  // useRef — its value must never be read during render). Fed into the
  // session below and directly into the sidecar hooks, same split
  // ownership RaceBoxLiveRecord uses: the session only ever calls
  // `addPrimary`, the sidecar hooks only ever call `addSecondary`.
  const [vescMerger] = useState(() => new ConcurrentSourceMerger<unknown, VescSetupValues>());
  const vesc = useVescSidecar(vescMerger);
  const [bmsMerger] = useState(() => new ConcurrentSourceMerger<unknown, BmsSample>());
  const bms = useBmsSidecar(bmsMerger);

  useEffect(() => {
    const timer = new RealtimeLapTimer();
    // Tracks load async + offline-cached; the engine detects once available.
    loadTracks().then((tracks) => timer.setTracks(tracks)).catch(() => { /* offline / no tracks */ });

    // The session keeps its own recorded buffer; don't double-retain in the source.
    const gps = new CustomGps({ retainBuffer: false });
    const session = new LapTimerSession({
      gps,
      timer,
      saveLog: saveFile,
      saveMeta: saveFileMetadata,
      vescMerger,
      bmsMerger,
    });
    sessionRef.current = session;

    const off = session.subscribe(setSnapshot);
    session.start();

    return () => {
      off();
      session.dispose();
    };
    // vescMerger/bmsMerger are stable for the tool's lifetime (lazy useState
    // initializers above) — omitted from deps so this effect never re-runs
    // GPS setup because of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A late unmount must still release any sidecar BLE connection, same
  // reasoning as RaceBoxLiveRecord's teardown — leaking a paired GATT server
  // keeps the device unreachable to the next page load.
  useEffect(() => {
    return () => {
      void vesc.disconnect();
      void bms.disconnect();
    };
    // Only the disconnect functions (stable off their mergers) are used here;
    // depending on the whole vesc/bms objects would re-run this cleanup on
    // every render, tearing down BLE connections mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesc.disconnect, bms.disconnect]);

  const endSession = useCallback(() => sessionRef.current?.endSession() ?? Promise.resolve(), []);
  const reset = useCallback(() => sessionRef.current?.reset(), []);

  return { ...snapshot, endSession, reset, vesc, bms };
}
