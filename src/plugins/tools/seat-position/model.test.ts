import { describe, it, expect } from "vitest";
import {
  DEFAULT_PARAMS,
  ZERO_ADJUSTMENTS,
  axleLoads,
  computeCoM,
  computeMassElements,
  computeState,
  fitKLegs,
  hipPoint,
  legMassKg,
  lateralTransferKg,
  rearMountMmFromTiltDeg,
  rebaseline,
  sensitivity,
  slideSensitivityPctPerMm,
  solveKneeIK,
  tiltDegFromRearMountMm,
  torsoMassKg,
  totalMassKg,
  totalsFromCorners,
  type SeatModelParams,
} from "./model";

const p: SeatModelParams = DEFAULT_PARAMS;

describe("seat position model — statics", () => {
  it("moments balance: front + rear === total exactly", () => {
    const { loads } = computeState(p, { slideMm: 13, tiltDeg: 2.5 });
    expect(loads.frontKg + loads.rearKg).toBeCloseTo(loads.totalKg, 12);
    expect(loads.frontPct + loads.rearPct).toBeCloseTo(100, 12);
  });

  it("CoM is linear: translating every element by Δ translates the CoM by Δ", () => {
    const elements = computeMassElements(p, { slideMm: -10, tiltDeg: 1 });
    const com = computeCoM(elements);
    const shifted = computeCoM(elements.map((e) => ({ ...e, xMm: e.xMm + 37, zMm: e.zMm - 12 })));
    expect(shifted.xMm).toBeCloseTo(com.xMm + 37, 9);
    expect(shifted.zMm).toBeCloseTo(com.zMm - 12, 9);
    expect(shifted.massKg).toBeCloseTo(com.massKg, 12);
  });

  it("zero adjustments reproduce the baseline front% and CoG height exactly", () => {
    const { loads, com } = computeState(p, ZERO_ADJUSTMENTS);
    expect(loads.frontPct).toBeCloseTo(p.baselineFrontPct, 9);
    expect(com.zMm).toBeCloseTo(p.baselineCogZMm, 9);
  });

  it("mass bookkeeping: elements sum to the class weight", () => {
    const { com } = computeState(p, ZERO_ADJUSTMENTS);
    expect(com.massKg).toBeCloseTo(totalMassKg(p), 12);
    expect(torsoMassKg(p) + legMassKg(p)).toBeCloseTo(p.driverMassKg, 12);
  });
});

describe("seat position model — slide", () => {
  it("numeric slide sensitivity matches the closed-form Section 5 formula", () => {
    const closedForm = slideSensitivityPctPerMm(p);
    const f1 = computeState(p, { slideMm: 10, tiltDeg: 0 }).loads.frontPct;
    const f0 = computeState(p, { slideMm: -10, tiltDeg: 0 }).loads.frontPct;
    expect((f1 - f0) / 20).toBeCloseTo(closedForm, 9);
  });

  it("defaults land near the karting rule of thumb: ~1% F/R per inch of slide", () => {
    const pctPerInch = slideSensitivityPctPerMm(p) * 25.4;
    expect(pctPerInch).toBeGreaterThan(0.8);
    expect(pctPerInch).toBeLessThan(1.3);
  });

  it("slide does not change the CoG height", () => {
    const z0 = computeState(p, ZERO_ADJUSTMENTS).com.zMm;
    const z1 = computeState(p, { slideMm: 25.4, tiltDeg: 0 }).com.zMm;
    expect(z1).toBeCloseTo(z0, 9);
  });

  it("kLegs = 1 degenerates to the naive whole-driver-moves model", () => {
    const naive: SeatModelParams = { ...p, kLegs: 1 };
    const moved = torsoMassKg(p) + p.seatMassKg + legMassKg(p);
    expect(slideSensitivityPctPerMm(naive)).toBeCloseTo(
      (100 * moved) / (totalMassKg(p) * p.wheelbaseMm),
      12,
    );
  });
});

describe("seat position model — tilt", () => {
  it("zero tilt is the identity", () => {
    const a = computeState(p, ZERO_ADJUSTMENTS);
    const b = computeState(p, { slideMm: 0, tiltDeg: 0 });
    expect(b.com.xMm).toBeCloseTo(a.com.xMm, 12);
    expect(b.com.zMm).toBeCloseTo(a.com.zMm, 12);
  });

  it("recline shifts weight rearward AND lowers the CoG (default geometry)", () => {
    const zero = computeState(p, ZERO_ADJUSTMENTS);
    const reclined = computeState(p, { slideMm: 0, tiltDeg: 5 });
    expect(reclined.loads.frontPct).toBeLessThan(zero.loads.frontPct);
    expect(reclined.com.zMm).toBeLessThan(zero.com.zMm);
  });

  it("small-angle tilt matches the analytic linearization within 2%", () => {
    // d(x')/dφ at φ=0 for a rotated offset (dx, dz) is −dz (per radian); legs
    // couple through the hip with factor kLegs.
    const DEG = Math.PI / 180;
    const torsoDz = p.torsoRMm * Math.sin(p.torsoAlphaDeg * DEG);
    const M = totalMassKg(p);
    const linearPerDeg =
      ((-DEG * (torsoMassKg(p) * torsoDz + p.seatMassKg * p.seatComDzMm + p.kLegs * legMassKg(p) * p.hipDzMm)) / M) *
      (100 / p.wheelbaseMm);

    const phi = 0.5;
    const f1 = computeState(p, { slideMm: 0, tiltDeg: phi }).loads.frontPct;
    const f0 = computeState(p, { slideMm: 0, tiltDeg: -phi }).loads.frontPct;
    const numericPerDeg = (f1 - f0) / (2 * phi);
    expect(Math.abs(numericPerDeg - linearPerDeg)).toBeLessThan(Math.abs(linearPerDeg) * 0.02);
  });

  it("rear-mount mm ⇄ degrees round-trips", () => {
    const deg = tiltDegFromRearMountMm(15, p.rearMountArmMm);
    expect(rearMountMmFromTiltDeg(deg, p.rearMountArmMm)).toBeCloseTo(15, 9);
    expect(deg).toBeGreaterThan(0); // lowering the rear mount = recline
  });

  it("sensitivity readout reports both axes with sane signs", () => {
    const s = sensitivity(p, ZERO_ADJUSTMENTS);
    expect(s.pctPerInch).toBeGreaterThan(0); // forward slide adds front weight
    expect(s.pctPerDeg).toBeLessThan(0); // recline removes front weight
  });
});

describe("seat position model — knee IK", () => {
  const hip = { x: 290, z: 180 };
  const foot = { x: 950, z: 130 };

  it("preserves both segment lengths when the foot is reachable", () => {
    const knee = solveKneeIK(hip, foot, 420, 430);
    expect(Math.hypot(knee.x - hip.x, knee.z - hip.z)).toBeCloseTo(420, 9);
    expect(Math.hypot(knee.x - foot.x, knee.z - foot.z)).toBeCloseTo(430, 9);
  });

  it("picks the knee-up solution", () => {
    const knee = solveKneeIK(hip, foot, 420, 430);
    expect(knee.z).toBeGreaterThan(Math.max(hip.z, foot.z));
  });

  it("clamps onto the hip→foot line when out of reach", () => {
    const knee = solveKneeIK(hip, { x: hip.x + 2000, z: hip.z }, 420, 430);
    expect(knee.x).toBeCloseTo(hip.x + 420, 9);
    expect(knee.z).toBeCloseTo(hip.z, 9);
  });
});

describe("seat position model — calibration", () => {
  it("corner totals", () => {
    const t = totalsFromCorners({ fl: 35, fr: 34, rl: 46, rr: 47 });
    expect(t.totalKg).toBeCloseTo(162, 12);
    expect(t.frontKg).toBeCloseTo(69, 12);
    expect(t.frontPct).toBeCloseTo((100 * 69) / 162, 12);
  });

  it("round-trips kLegs from synthetic scale data", () => {
    const truth: SeatModelParams = { ...p, kLegs: 0.55 };
    const slideMm = 20;
    const baseline = computeState(truth, ZERO_ADJUSTMENTS).loads;
    const moved = computeState(truth, { slideMm, tiltDeg: 0 }).loads;
    const fitted = fitKLegs({
      baselineFrontKg: baseline.frontKg,
      movedFrontKg: moved.frontKg,
      slideMm,
      wheelbaseMm: truth.wheelbaseMm,
      torsoMassKg: torsoMassKg(truth),
      seatMassKg: truth.seatMassKg,
      legMassKg: legMassKg(truth),
    });
    expect(fitted).toBeCloseTo(0.55, 9);
  });

  it("clamps a nonsense fit into [0, 1]", () => {
    const args = {
      slideMm: 20,
      wheelbaseMm: p.wheelbaseMm,
      torsoMassKg: torsoMassKg(p),
      seatMassKg: p.seatMassKg,
      legMassKg: legMassKg(p),
    };
    expect(fitKLegs({ ...args, baselineFrontKg: 69, movedFrontKg: 69 - 5 })).toBe(0);
    expect(fitKLegs({ ...args, baselineFrontKg: 69, movedFrontKg: 69 + 50 })).toBe(1);
  });
});

describe("seat position model — dynamic context", () => {
  it("lateral transfer scales with CoG height", () => {
    const com = computeState(p, ZERO_ADJUSTMENTS).com;
    const low = lateralTransferKg({ ...com, zMm: com.zMm - 10 }, p.trackWidthMm, 1.5);
    const base = lateralTransferKg(com, p.trackWidthMm, 1.5);
    expect(low).toBeLessThan(base);
    expect(base).toBeCloseTo((com.massKg * 1.5 * com.zMm) / p.trackWidthMm, 12);
  });

  it("axleLoads is consistent with front% = 100·x/L", () => {
    const loads = axleLoads({ xMm: 447.2, zMm: 250, massKg: 162 }, 1040);
    expect(loads.frontPct).toBeCloseTo((100 * 447.2) / 1040, 12);
  });

  it("rebaseline folds adjustments in exactly: new params at zero === old params at adj", () => {
    const adj = { slideMm: 15, tiltDeg: 3 };
    const before = computeState(p, adj);
    const rebased = computeState(rebaseline(p, adj), ZERO_ADJUSTMENTS);
    expect(rebased.loads.frontPct).toBeCloseTo(before.loads.frontPct, 9);
    expect(rebased.com.xMm).toBeCloseTo(before.com.xMm, 9);
    expect(rebased.com.zMm).toBeCloseTo(before.com.zMm, 9);
  });

  it("hipPoint moves 1:1 with slide", () => {
    const h0 = hipPoint(p, ZERO_ADJUSTMENTS);
    const h1 = hipPoint(p, { slideMm: 12, tiltDeg: 0 });
    expect(h1.x - h0.x).toBeCloseTo(12, 12);
    expect(h1.z).toBeCloseTo(h0.z, 12);
  });
});
