/**
 * Orchestration for the Phone Datalogger tool: wires the GPS source, the session
 * gate, and the realtime lap timer, and persists the session as a `.dovep` log
 * on end. All the testable logic lives in `@/lib/gps/*` (pure, unit-tested); this
 * hook is the thin browser-facing glue (geolocation + IndexedDB + React state).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CustomGps,
  type GpsObservation,
  RealtimeLapTimer,
  type TimingState,
  EMPTY_TIMING_STATE,
  observationToSample,
  initSessionGate,
  stepSessionGate,
  endSessionGate,
  type SessionPhase,
  serializeDovepBlob,
  buildDovepFileName,
  type DovepSessionMeta,
} from "@/lib/gps";
import { MPS_TO_MPH } from "@/lib/parserUtils";
import { loadTracks } from "@/lib/trackStorage";
import { saveFile, saveFileMetadata } from "@/lib/fileStorage";

export interface DataloggerState {
  phase: SessionPhase;
  timing: TimingState;
  /** Latest captured observation (for the live map/readouts). */
  latest: GpsObservation | null;
  /** Number of observations recorded into the log so far. */
  recordedCount: number;
  /** Filename once the session has been saved to IndexedDB. */
  savedFileName: string | null;
  error: string | null;
}

export interface DataloggerController extends DataloggerState {
  /** Manually end + save the session (the red "End session" action). */
  endSession: () => Promise<void>;
}

export function useDatalogger(): DataloggerController {
  const gpsRef = useRef<CustomGps | null>(null);
  const timerRef = useRef<RealtimeLapTimer | null>(null);
  const gateRef = useRef(initSessionGate());
  const recordedRef = useRef<GpsObservation[]>([]);
  const savingRef = useRef(false);

  const [phase, setPhase] = useState<SessionPhase>("waiting");
  const [timing, setTiming] = useState<TimingState>(EMPTY_TIMING_STATE);
  const [latest, setLatest] = useState<GpsObservation | null>(null);
  const [recordedCount, setRecordedCount] = useState(0);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Serialize the recorded buffer to a `.dovep` log and store it in IndexedDB. */
  const persist = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const observations = recordedRef.current;
    if (observations.length === 0) return;

    const timer = timerRef.current;
    const laps = timer ? [...timer.getLaps()] : [];
    const t = timer?.getState() ?? EMPTY_TIMING_STATE;
    const startTs = observations[0].fix.timestamp;
    const fileName = buildDovepFileName(startTs);

    const meta: DovepSessionMeta = {
      course: t.courseName ?? undefined,
      bestLapMs: t.bestLapMs ?? undefined,
      optimalMs: t.optimalMs ?? undefined,
      lapTimesMs: laps.map((l) => l.lapTimeMs),
    };

    try {
      await saveFile(fileName, serializeDovepBlob(observations, meta));
      await saveFileMetadata({
        fileName,
        trackName: t.trackName ?? "",
        courseName: t.courseName ?? "",
        sessionStartTime: startTs,
        fastestLapMs: t.bestLapMs ?? undefined,
      });
      setSavedFileName(fileName);
    } catch (e) {
      setError(`Failed to save session: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const finish = useCallback(async () => {
    gateRef.current = endSessionGate(gateRef.current);
    setPhase("ended");
    gpsRef.current?.stop();
    await persist();
  }, [persist]);

  const endSession = useCallback(async () => {
    if (gateRef.current.phase === "ended") return;
    await finish();
  }, [finish]);

  useEffect(() => {
    const timer = new RealtimeLapTimer();
    timerRef.current = timer;
    // Tracks load async + offline-cached; the engine detects once available.
    loadTracks().then((tracks) => timer.setTracks(tracks)).catch(() => { /* offline / no tracks */ });

    const gps = new CustomGps();
    gpsRef.current = gps;

    const offFix = gps.onFix((obs) => {
      setLatest(obs);
      const speedMph = (obs.motion.speedMps ?? 0) * MPS_TO_MPH;
      const step = stepSessionGate(gateRef.current, speedMph, obs.fix.timestamp);
      gateRef.current = step.state;

      if (step.justArmed) setPhase("recording");

      if (gateRef.current.phase === "recording") {
        recordedRef.current.push(obs);
        setRecordedCount(recordedRef.current.length);
        setTiming(timer.update(observationToSample(obs)));
      }

      if (step.autoEnded) {
        setPhase("ended");
        gps.stop();
        void persist();
      }
    });

    const offErr = gps.onError((err) => setError(err.message));
    gps.start();

    return () => {
      offFix();
      offErr();
      gps.stop();
    };
  }, [persist]);

  return { phase, timing, latest, recordedCount, savedFileName, error, endSession };
}
