import { describe, it, expect, vi } from "vitest";
import { LapTimerSession, type LapTimerSnapshot } from "./lapTimerSession";
import { CustomGps, RealtimeLapTimer, AUTO_END_STOPPED_MS } from "@/lib/gps";
import type { Track } from "@/types/racing";
import { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";
import type { VescSetupValues } from "@/lib/live/vescDecoder";
import type { BmsSample } from "@/lib/live/bmsTransport";

const FAKE_VESC_SAMPLE: VescSetupValues = {
  tempEscC: 32,
  tempMotorC: 28,
  motorCurrentA: 12,
  batteryCurrentA: 8,
  dutyCycle: 0.5,
  erpm: 12_000,
  batteryVoltageV: 48.2,
  ampHours: 1.2,
  faultCode: 0,
  speedMps: 9,
  batteryLevel: 0.8,
  tripMeters: 500,
  wattHours: 40,
};

const FAKE_BMS_SAMPLE: BmsSample = {
  basicInfo: {
    voltageV: 48.5,
    currentA: 5,
    remainAh: 10,
    nominalAh: 12,
    cycles: 3,
    socPct: 83,
    chargeFetOn: true,
    dischargeFetOn: true,
    numCells: 13,
    numTemps: 3,
    tempsC: [30, 28, 27],
    protectionStatus: 0,
    balanceStatus: 0,
  },
  cellVoltages: null,
};

const FAR_TRACK: Track = {
  name: "Far",
  courses: [{ name: "c", startFinishA: { lat: 40, lon: 40 }, startFinishB: { lat: 40, lon: 40.001 } }],
};

// The FakeGeo default fix is at (45, -73), so this track sits right under it.
const NEAR_TRACK: Track = {
  name: "Orlando Kart Center",
  courses: [{ name: "Normal", startFinishA: { lat: 45, lon: -73 }, startFinishB: { lat: 45, lon: -72.999 } }],
};

/** Controllable fake Geolocation (mirrors the one in customGps.test.ts). */
class FakeGeo {
  successCb: PositionCallback | null = null;
  errorCb: PositionErrorCallback | null = null;
  watchCalls = 0;
  cleared: number[] = [];
  private nextId = 1;

  watchPosition(s: PositionCallback, e?: PositionErrorCallback | null): number {
    this.watchCalls++;
    this.successCb = s;
    this.errorCb = e ?? null;
    return this.nextId++;
  }
  clearWatch(id: number): void {
    this.cleared.push(id);
  }
  getCurrentPosition(): void { /* unused */ }

  emit(coords: Partial<GeolocationCoordinates>, timestamp: number): void {
    this.successCb?.({
      timestamp,
      coords: {
        latitude: 45,
        longitude: -73,
        altitude: null,
        accuracy: 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        ...coords,
      } as GeolocationCoordinates,
    } as GeolocationPosition);
  }
}

const BASE_TS = 1_700_000_000_000;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(
  saveLog = vi.fn().mockResolvedValue(undefined),
  sidecars: {
    vescMerger?: ConcurrentSourceMerger<unknown, VescSetupValues>;
    bmsMerger?: ConcurrentSourceMerger<unknown, BmsSample>;
  } = {},
) {
  const geo = new FakeGeo();
  const gps = new CustomGps({ geolocation: geo as unknown as Geolocation, retainBuffer: false });
  const timer = new RealtimeLapTimer();
  const saveMeta = vi.fn().mockResolvedValue(undefined);
  const session = new LapTimerSession({ gps, timer, saveLog, saveMeta, ...sidecars });
  const snapshots: LapTimerSnapshot[] = [];
  session.subscribe((s) => snapshots.push(s));
  return { geo, gps, timer, saveLog, saveMeta, session, snapshots };
}

/** Emit `n` moving fixes (speed in m/s; 10 ≈ 22 mph, well above the 5 mph arm). */
function drive(geo: FakeGeo, n: number, speed = 10, startTs = BASE_TS): void {
  for (let i = 0; i < n; i++) geo.emit({ latitude: 45 + i * 0.0001, speed }, startTs + i * 1_000);
}

describe("LapTimerSession", () => {
  it("stays in waiting below the arm speed", () => {
    const { geo, session } = setup();
    session.start();
    geo.emit({ speed: 1 }, BASE_TS); // ~2 mph
    expect(session.getSnapshot().phase).toBe("waiting");
  });

  it("arms and records once above the arm speed", () => {
    const { geo, session } = setup();
    session.start();
    drive(geo, 3);
    const s = session.getSnapshot();
    expect(s.phase).toBe("recording");
    expect(s.latest).not.toBeNull();
  });

  it("surfaces 'no track nearby' while still waiting (before arming)", () => {
    const { geo, timer, session } = setup();
    timer.setTracks([FAR_TRACK]);
    session.start();
    geo.emit({ latitude: 0, longitude: 0.0005, speed: 1 }, BASE_TS); // ~2 mph → waiting
    const s = session.getSnapshot();
    expect(s.phase).toBe("waiting");
    expect(s.timing.nearKnownTrack).toBe(false);
  });

  it("names the recognised track while still waiting (parked at a known track)", () => {
    const { geo, timer, session } = setup();
    timer.setTracks([NEAR_TRACK]);
    session.start();
    geo.emit({ latitude: 45, longitude: -73, speed: 1 }, BASE_TS); // ~2 mph → waiting
    const s = session.getSnapshot();
    expect(s.phase).toBe("waiting");
    expect(s.timing.nearKnownTrack).toBe(true);
    expect(s.timing.nearbyTrackName).toBe("Orlando Kart Center");
  });

  // Regression: ending with nothing recorded must NOT get stuck "saving" and must
  // not write a file.
  it("ends cleanly with no data — not stuck saving, nothing written", async () => {
    const { geo, session, saveLog, saveMeta } = setup();
    session.start();
    geo.emit({ speed: 1 }, BASE_TS); // never arms
    await session.endSession();
    const s = session.getSnapshot();
    expect(s.phase).toBe("ended");
    expect(s.saving).toBe(false);
    expect(s.savedFileName).toBeNull();
    expect(saveLog).not.toHaveBeenCalled();
    expect(saveMeta).not.toHaveBeenCalled();
  });

  it("persists an .rplx log + metadata on manual end", async () => {
    const { geo, session, saveLog, saveMeta } = setup();
    session.start();
    drive(geo, 5);
    await session.endSession();
    const s = session.getSnapshot();
    expect(saveLog).toHaveBeenCalledTimes(1);
    const [name, blob] = saveLog.mock.calls[0];
    expect(name).toMatch(/\.rplx$/);
    expect(blob).toBeInstanceOf(Blob);
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(s.savedFileName).toBe(name);
    expect(s.saving).toBe(false);
    expect(s.phase).toBe("ended");
  });

  it("does not double-save when endSession is called twice", async () => {
    const { geo, session, saveLog } = setup();
    session.start();
    drive(geo, 3);
    await session.endSession();
    await session.endSession();
    expect(saveLog).toHaveBeenCalledTimes(1);
  });

  it("reset() returns to waiting and re-arms the GPS for a new session", async () => {
    const { geo, session } = setup();
    session.start();
    drive(geo, 3);
    await session.endSession();

    session.reset();
    expect(session.getSnapshot().phase).toBe("waiting");
    expect(session.getSnapshot().savedFileName).toBeNull();
    expect(geo.watchCalls).toBe(2); // GPS restarted

    drive(geo, 3, 10, BASE_TS + 1_000_000);
    expect(session.getSnapshot().phase).toBe("recording");
  });

  it("surfaces a save error and clears the saving flag", async () => {
    const { geo, session, saveLog } = setup(vi.fn().mockRejectedValue(new Error("disk full")));
    session.start();
    drive(geo, 3);
    await session.endSession();
    const s = session.getSnapshot();
    expect(s.error).toMatch(/disk full/);
    expect(s.saving).toBe(false);
    expect(s.errorCode).toBeNull();
  });

  it("auto-ends and persists after the stopped-idle timeout", async () => {
    const { geo, session, saveLog } = setup();
    session.start();
    drive(geo, 2); // arm + record
    geo.emit({ speed: 0 }, BASE_TS + 5_000); // stopped — idle timer starts
    geo.emit({ speed: 0 }, BASE_TS + 5_000 + AUTO_END_STOPPED_MS + 1_000); // past the timeout
    expect(session.getSnapshot().phase).toBe("ended");
    await flush();
    expect(saveLog).toHaveBeenCalledTimes(1);
  });

  it("forwards a GPS error and its normalized code to the snapshot", () => {
    const { geo, session } = setup();
    session.start();
    geo.errorCb?.({ code: 1, message: "denied" } as GeolocationPositionError);
    expect(session.getSnapshot().error).toBe("denied");
    expect(session.getSnapshot().errorCode).toBe("permission-denied");
  });

  // Issues #58/#73: a VESC or BMS sidecar must work without a RaceBox or
  // Dragy — the phone GPS is the primary source, and the sidecar attaches
  // straight to LapTimerSession the same way it attaches to RaceBoxLiveRecord.
  describe("VESC/BMS sidecars", () => {
    it("still writes a plain .rplx log when no sidecar ever reports data", async () => {
      const vescMerger = new ConcurrentSourceMerger<unknown, VescSetupValues>();
      const { geo, session, saveLog } = setup(vi.fn().mockResolvedValue(undefined), { vescMerger });
      session.start();
      drive(geo, 3);
      await session.endSession();
      const [name] = saveLog.mock.calls[0];
      expect(name).toMatch(/\.rplx$/);
    });

    it("writes a .rplive log with VESC channels merged in once the sidecar reports data", async () => {
      const vescMerger = new ConcurrentSourceMerger<unknown, VescSetupValues>();
      const { geo, session, saveLog } = setup(vi.fn().mockResolvedValue(undefined), { vescMerger });
      session.start();
      vescMerger.addSecondary({ receivedAt: Date.now(), data: FAKE_VESC_SAMPLE });
      drive(geo, 3);
      await session.endSession();
      const [name, blob] = saveLog.mock.calls[0];
      expect(name).toMatch(/\.rplive$/);
      const pkg = JSON.parse(await blob.text());
      expect(pkg.source).toEqual({ kind: "phone" });
      expect(pkg.samples.length).toBeGreaterThan(0);
      expect(pkg.samples.at(-1).extraFields["Battery Voltage (V)"]).toBe(FAKE_VESC_SAMPLE.batteryVoltageV);
      expect(pkg.fieldMappings.some((f: { name: string }) => f.name === "Battery Voltage (V)")).toBe(true);
    });

    it("writes a .rplive log with BMS channels merged in once the sidecar reports data", async () => {
      const bmsMerger = new ConcurrentSourceMerger<unknown, BmsSample>();
      const { geo, session, saveLog } = setup(vi.fn().mockResolvedValue(undefined), { bmsMerger });
      session.start();
      bmsMerger.addSecondary({ receivedAt: Date.now(), data: FAKE_BMS_SAMPLE });
      drive(geo, 3);
      await session.endSession();
      const [name, blob] = saveLog.mock.calls[0];
      expect(name).toMatch(/\.rplive$/);
      const pkg = JSON.parse(await blob.text());
      expect(pkg.samples.at(-1).extraFields["Pack Voltage (V)"]).toBe(FAKE_BMS_SAMPLE.basicInfo.voltageV);
      expect(pkg.samples.at(-1).extraFields["MOSFET Temp (C)"]).toBe(FAKE_BMS_SAMPLE.basicInfo.tempsC[0]);
    });

    it("merges both sidecars into the same sample when both report data", async () => {
      const vescMerger = new ConcurrentSourceMerger<unknown, VescSetupValues>();
      const bmsMerger = new ConcurrentSourceMerger<unknown, BmsSample>();
      const { geo, session, saveLog } = setup(vi.fn().mockResolvedValue(undefined), { vescMerger, bmsMerger });
      session.start();
      vescMerger.addSecondary({ receivedAt: Date.now(), data: FAKE_VESC_SAMPLE });
      bmsMerger.addSecondary({ receivedAt: Date.now(), data: FAKE_BMS_SAMPLE });
      drive(geo, 3);
      await session.endSession();
      const [, blob] = saveLog.mock.calls[0];
      const pkg = JSON.parse(await blob.text());
      const last = pkg.samples.at(-1).extraFields;
      expect(last["Battery Voltage (V)"]).toBe(FAKE_VESC_SAMPLE.batteryVoltageV);
      expect(last["Pack Voltage (V)"]).toBe(FAKE_BMS_SAMPLE.basicInfo.voltageV);
    });
  });
});
