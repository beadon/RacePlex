/**
 * LapTimerSession — the framework-free orchestration for the Lap Timer tool.
 *
 * Holds the session lifecycle that used to live inside the React hook: it drives
 * the GPS source through the session gate (arm above 5 mph / auto-idle), feeds
 * recorded fixes to the realtime timer, and persists the session on end — as
 * `.rplx`, or `.rplive` when an optional VESC/BMS/heart-rate sidecar (issues
 * #58, #73, #87) reported any data, so a rider isn't required to also have a
 * RaceBox or Dragy to record those channels alongside their phone's GPS.
 * Every dependency (GPS source, timer, save functions, sidecar mergers) is
 * injected, so the whole flow is unit-testable with a fake geolocation +
 * fake persistence — the hook is then a thin adapter that subscribes to
 * snapshots.
 */
import {
  type CustomGps,
  type GpsObservation,
  type GpsErrorCode,
  type RealtimeLapTimer,
  type TimingState,
  EMPTY_TIMING_STATE,
  observationToSample,
  initSessionGate,
  stepSessionGate,
  endSessionGate,
  type SessionGateState,
  type SessionPhase,
  serializeRplxBlob,
  buildRplxFileName,
  type RplxSessionMeta,
} from "@/lib/gps";
import type { Lap, GpsSample, FieldMapping, ParsedData } from "@/types/racing";
import type { FileMetadata } from "@/lib/fileStorage";
import { MPS_TO_MPH } from "@/lib/parserUtils";
import type { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";
import type { VescSetupValues } from "@/lib/live/vescDecoder";
import { applyVescMergeToExtraFields, appendVescFieldMappings } from "@/lib/live/vescMergeFields";
import type { BmsSample } from "@/lib/live/bmsTransport";
import { applyBmsMergeToExtraFields, appendBmsFieldMappings } from "@/lib/live/bmsMergeFields";
import type { HeartRateSample } from "@/lib/live/heartRateDecoder";
import { applyHeartRateMergeToExtraFields, appendHeartRateFieldMappings } from "@/lib/live/heartRateMergeFields";
import { buildLiveCaptureFileName, serializeLiveCapture } from "@/lib/live/liveCapturePackage";
import { calculateBounds } from "@/lib/parserUtils";

export interface LapTimerSnapshot {
  phase: SessionPhase;
  timing: TimingState;
  /** Completed laps with major-sector rollup. */
  laps: Lap[];
  /** Latest captured observation (live speed/quality). */
  latest: GpsObservation | null;
  /** True while the `.rplx` log is being written. */
  saving: boolean;
  /** Filename once the session has been saved. */
  savedFileName: string | null;
  /** The exact bytes written for `savedFileName` — lets the UI share/download
   *  the session without a round-trip back through IndexedDB. */
  savedBlob: Blob | null;
  /**
   * The session already parsed, ready to hand to the main viewer — but only
   * on explicit request (a "View session" click), never fired automatically.
   * `Index.tsx` unmounts its whole Dashboard subtree (this tool included) the
   * instant a session loads, so auto-firing this at save time would tear the
   * "ended" screen out from under the rider before they could see it, let
   * alone tap Share first — confirmed live, not just reasoned through.
   */
  savedData: ParsedData | null;
  error: string | null;
  /**
   * Normalized code for `error`, when it came from the GPS source (null for a
   * save error or no error). `'permission-denied'` is what the UI checks to
   * offer OS-specific re-enable instructions (issue: iOS Safari location
   * permission denial leaves the tool silently unable to record).
   */
  errorCode: GpsErrorCode | null;
}

export const INITIAL_SNAPSHOT: LapTimerSnapshot = {
  phase: "waiting",
  timing: EMPTY_TIMING_STATE,
  laps: [],
  latest: null,
  saving: false,
  savedFileName: null,
  savedBlob: null,
  savedData: null,
  error: null,
  errorCode: null,
};

export interface LapTimerSessionDeps {
  gps: CustomGps;
  timer: RealtimeLapTimer;
  /** Persist the raw log blob (e.g. fileStorage.saveFile). */
  saveLog: (fileName: string, blob: Blob) => Promise<void>;
  /** Persist the file metadata (e.g. fileStorage.saveFileMetadata). */
  saveMeta: (meta: FileMetadata) => Promise<void>;
  /**
   * Optional VESC/BMS sidecars (issues #58, #73) — the same
   * `ConcurrentSourceMerger` pattern `RaceBoxLiveRecord`/`DragyLiveRecord`
   * use, so a rider gets ESC/BMS channels merged into their phone-GPS log
   * with no RaceBox or Dragy required. Omit either (or both) when the rider
   * hasn't connected that sidecar for this session.
   */
  vescMerger?: ConcurrentSourceMerger<unknown, VescSetupValues>;
  bmsMerger?: ConcurrentSourceMerger<unknown, BmsSample>;
  /**
   * Optional heart-rate sidecar (issue #87) — same pattern, but never bound
   * to a Vehicle/Garage profile the way VESC/BMS are: a heart-rate monitor
   * belongs to the rider, not the board.
   */
  heartRateMerger?: ConcurrentSourceMerger<unknown, HeartRateSample>;
}

type Listener = (snapshot: LapTimerSnapshot) => void;

export class LapTimerSession {
  private gate: SessionGateState = initSessionGate();
  private recorded: GpsObservation[] = [];
  /**
   * `recorded` converted to `GpsSample` + any sidecar channels merged in.
   * Kept alongside `recorded` (not instead of it) because `.rplx` still
   * writes straight from `GpsObservation`; this only gets used at persist
   * time when a sidecar actually reported data — see `persist()`.
   */
  private samples: GpsSample[] = [];
  private snapshot: LapTimerSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private offFix: (() => void) | null = null;
  private offErr: (() => void) | null = null;

  constructor(private readonly deps: LapTimerSessionDeps) {}

  getSnapshot(): LapTimerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to the GPS source and begin capturing. */
  start(): void {
    this.offFix = this.deps.gps.onFix((obs) => this.handleFix(obs));
    this.offErr = this.deps.gps.onError((err) => this.patch({ error: err.message, errorCode: err.code }));
    this.deps.gps.start();
  }

  /** Manually end the session and persist it. */
  async endSession(): Promise<void> {
    if (this.gate.phase === "ended") return;
    this.gate = endSessionGate(this.gate);
    this.deps.gps.stop();
    this.patch({ phase: "ended" });
    await this.persist();
  }

  /** Discard the ended session and start a fresh capture (reuses GPS + tracks). */
  reset(): void {
    this.gate = initSessionGate();
    this.recorded = [];
    this.samples = [];
    this.deps.vescMerger?.reset();
    this.deps.bmsMerger?.reset();
    this.deps.heartRateMerger?.reset();
    this.deps.timer.reset();
    this.deps.gps.clear();
    this.deps.gps.start();
    this.snapshot = INITIAL_SNAPSHOT;
    this.emit();
  }

  /** Tear down listeners and stop the GPS source. */
  dispose(): void {
    this.offFix?.();
    this.offErr?.();
    this.offFix = null;
    this.offErr = null;
    this.deps.gps.stop();
  }

  private handleFix(obs: GpsObservation): void {
    const speedMps = obs.fix.speed != null ? obs.fix.speed : obs.motion.speedMps ?? 0;
    const step = stepSessionGate(this.gate, speedMps * MPS_TO_MPH, obs.fix.timestamp);
    this.gate = step.state;

    const patch: Partial<LapTimerSnapshot> = { latest: obs };
    if (step.justArmed) patch.phase = "recording";

    // A connected VESC/BMS should keep recording whether or not the rider is
    // moving — a pack heating up on the charger or an ESC being bench-tested
    // is exactly the kind of thing worth capturing while parked. Lap timing
    // itself stays gated on `phase === "recording"` below; only the sidecar
    // capture unconditionally follows sensor data instead of GPS speed.
    const sidecarLive = Boolean(
      this.deps.vescMerger?.hasSecondary || this.deps.bmsMerger?.hasSecondary || this.deps.heartRateMerger?.hasSecondary,
    );

    if (this.gate.phase === "recording" || sidecarLive) {
      this.recorded.push(obs);

      const sample = observationToSample(obs);
      // Every accepted fix gets paired against whichever sidecars are
      // connected (issues #58, #73) — `addPrimary` returns `secondary: null`
      // until that sidecar actually connects, so this is a no-op cost when
      // the rider hasn't added one.
      if (this.deps.vescMerger) {
        applyVescMergeToExtraFields(sample.extraFields, this.deps.vescMerger.addPrimary({ receivedAt: Date.now(), data: null }));
      }
      if (this.deps.bmsMerger) {
        applyBmsMergeToExtraFields(sample.extraFields, this.deps.bmsMerger.addPrimary({ receivedAt: Date.now(), data: null }));
      }
      if (this.deps.heartRateMerger) {
        applyHeartRateMergeToExtraFields(sample.extraFields, this.deps.heartRateMerger.addPrimary({ receivedAt: Date.now(), data: null }));
      }
      this.samples.push(sample);

      if (this.gate.phase === "recording") {
        patch.timing = this.deps.timer.update(sample);
        // Completed laps are immutable once closed — only swap the array (and
        // re-render the table) when a lap actually completes.
        const completed = this.deps.timer.getLaps();
        if (completed.length !== this.snapshot.laps.length) patch.laps = [...completed];
      }
    }
    if (this.gate.phase !== "recording") {
      // Before logging arms, still surface track proximity so the UI can explain
      // speedometer mode — either "no tracks nearby" or, when we *do* recognise a
      // track, confirm it by name (so a stationary driver knows detection worked).
      patch.timing = {
        ...this.snapshot.timing,
        nearKnownTrack: this.deps.timer.nearTrack(obs.fix.lat, obs.fix.lon),
        nearbyTrackName: this.deps.timer.nearestTrackName(obs.fix.lat, obs.fix.lon),
      };
    }
    this.patch(patch);

    if (step.autoEnded) {
      this.deps.gps.stop();
      this.patch({ phase: "ended" });
      void this.persist();
    }
  }

  /**
   * Serialize the recorded buffer and store it. Plain phone-GPS sessions
   * still write the standard `.rplx` log unchanged; a session where a VESC
   * or BMS sidecar ever reported data writes `.rplive` instead (mirrors
   * `RaceBoxLiveRecord`/`DragyLiveRecord`) so those channels aren't dropped —
   * `.rplx`'s CSV schema is fixed and has no room for extra channels.
   */
  private async persist(): Promise<void> {
    if (this.snapshot.saving || this.recorded.length === 0) return;
    this.patch({ saving: true });

    const t = this.deps.timer.getState();
    const laps = [...this.deps.timer.getLaps()];
    const startTs = this.recorded[0].fix.timestamp;
    const hasSidecarData = Boolean(
      this.deps.vescMerger?.hasSecondary || this.deps.bmsMerger?.hasSecondary || this.deps.heartRateMerger?.hasSecondary,
    );

    const fileName = hasSidecarData ? buildLiveCaptureFileName({ kind: "phone" }, new Date(startTs)) : buildRplxFileName(startTs);
    const meta: RplxSessionMeta = {
      course: t.courseName ?? undefined,
      bestLapMs: t.bestLapMs ?? undefined,
      optimalMs: t.optimalMs ?? undefined,
      lapTimesMs: laps.map((l) => l.lapTimeMs),
    };

    try {
      const blob = hasSidecarData
        ? serializeLiveCapture(this.buildLiveCaptureData(startTs), { kind: "phone" })
        : serializeRplxBlob(this.recorded, meta);
      await this.deps.saveLog(fileName, blob);
      await this.deps.saveMeta({
        fileName,
        trackName: t.trackName ?? "",
        courseName: t.courseName ?? "",
        sessionStartTime: startTs,
        fastestLapMs: t.bestLapMs ?? undefined,
        source: "phone-gps",
        hasVescData: Boolean(this.deps.vescMerger?.hasSecondary),
        hasBmsData: Boolean(this.deps.bmsMerger?.hasSecondary),
        hasHeartRateData: Boolean(this.deps.heartRateMerger?.hasSecondary),
      });
      // Parsed and ready, but deliberately not handed to the main viewer yet
      // — only a "View session" click does that (see `savedData`'s doc above).
      const live = this.buildLiveCaptureData(startTs);
      const savedData: ParsedData = {
        samples: live.samples,
        fieldMappings: live.fieldMappings,
        bounds: calculateBounds(live.samples),
        duration: live.samples.length > 0 ? live.samples[live.samples.length - 1].t : 0,
        startDate: live.startDate,
      };
      this.patch({ saving: false, savedFileName: fileName, savedBlob: blob, savedData });
    } catch (e) {
      this.patch({
        saving: false,
        error: `Failed to save session: ${e instanceof Error ? e.message : String(e)}`,
        errorCode: null,
      });
    }
  }

  /** Build the `.rplive` payload once a sidecar has reported data this session. */
  private buildLiveCaptureData(startTs: number): Pick<ParsedData, "samples" | "fieldMappings" | "startDate"> {
    const fieldMappings: FieldMapping[] = [
      { index: -1, name: "altitude", enabled: false },
      { index: -2, name: "h_acc", enabled: false },
      { index: -3, name: "v_acc", enabled: false },
    ];
    appendVescFieldMappings(fieldMappings, this.samples);
    appendBmsFieldMappings(fieldMappings, this.samples);
    appendHeartRateFieldMappings(fieldMappings, this.samples);
    return { samples: this.samples, fieldMappings, startDate: new Date(startTs) };
  }

  private patch(partial: Partial<LapTimerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
