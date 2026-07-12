import { describe, it, expect } from "vitest";
import {
  BOARD_COM_Z_FRACTION,
  CROUCH_COM_DROP,
  DEFAULT_PARAMS,
  DEFAULT_STANCE,
  KART_TYPICAL_COG_MM,
  STANDING_COM_FRACTION,
  TYPICAL_GRIP_G,
  axleLoads,
  axleLoadsAtAccel,
  boardCoM,
  brakingLimit,
  computeCoM,
  computeMassElements,
  computeState,
  crouchFactor,
  leanAngleDeg,
  loadTransferKg,
  maxHipHeightAboveDeck,
  riderCoM,
  riderMassFractionPct,
  solveKneeIK,
  thresholds,
  totalMassKg,
  type StanceAdjustments,
  type StanceParams,
} from "./model";

const p: StanceParams = DEFAULT_PARAMS;
const s: StanceAdjustments = DEFAULT_STANCE;

describe("stance model — statics", () => {
  it("mass bookkeeping: the two elements sum to the moving mass", () => {
    const com = computeCoM(computeMassElements(p, s));
    expect(com.massKg).toBeCloseTo(totalMassKg(p), 12);
    expect(totalMassKg(p)).toBe(87);
  });

  it("the rider is ~86% of the moving mass — the whole point vs a kart", () => {
    expect(riderMassFractionPct(p)).toBeCloseTo((100 * 75) / 87, 9);
    expect(riderMassFractionPct(p)).toBeGreaterThan(80);
  });

  it("a rider centred between the trucks gives exactly 50% front", () => {
    // Feet at 100/600 on a 700 wheelbase, even split → rider CoM at 350; the
    // board's is at 350 too, so the combined CoM lands on mid-wheelbase.
    const { loads, com } = computeState(p, s);
    expect(com.xMm).toBeCloseTo(350, 9);
    expect(loads.frontPct).toBeCloseTo(50, 9);
    expect(loads.frontKg).toBeCloseTo(43.5, 9);
    expect(loads.frontKg + loads.rearKg).toBeCloseTo(loads.totalKg, 12);
  });

  it("the CoM sits at the load-weighted mean of the feet", () => {
    // Hand-computable: 70% on the front foot → 0.7·600 + 0.3·100 = 450.
    const r = riderCoM(p, { ...s, weightSplitPct: 70 });
    expect(r.x).toBeCloseTo(450, 9);
  });

  it("rider CoM height is 0.55·stature above the deck (Winter)", () => {
    const r = riderCoM(p, s);
    expect(r.z).toBeCloseTo(110 + STANDING_COM_FRACTION * 1780, 9);
    expect(r.z).toBeCloseTo(1089, 9);
  });

  it("board CoM is mid-wheelbase, half deck height", () => {
    expect(boardCoM(p)).toEqual({ x: 350, z: 110 * BOARD_COM_Z_FRACTION });
  });

  it("combined CoG is ~946 mm — ~3.8× a kart's", () => {
    // z_cm = (12·55 + 75·1089) / 87
    const { com } = computeState(p, s);
    expect(com.zMm).toBeCloseTo((12 * 55 + 75 * 1089) / 87, 9);
    expect(com.zMm).toBeCloseTo(946.38, 2);
    expect(com.zMm / KART_TYPICAL_COG_MM).toBeGreaterThan(3.5);
  });

  it("front% = 100·x_cm/L, exactly", () => {
    const loads = axleLoads({ xMm: 220, zMm: 900, massKg: 87 }, 700);
    expect(loads.frontPct).toBeCloseTo((100 * 220) / 700, 12);
    expect(loads.frontKg).toBeCloseTo((87 * 220) / 700, 12);
    expect(loads.rearPct).toBeCloseTo(100 - loads.frontPct, 12);
  });

  it("moving the split rearward moves weight rearward, 1:1 with the CoM", () => {
    const even = computeState(p, s);
    const back = computeState(p, { ...s, weightSplitPct: 20 });
    // x_rider = 0.2·600 + 0.8·100 = 200 ⇒ x_cm = (12·350 + 75·200)/87
    expect(back.com.xMm).toBeCloseTo((12 * 350 + 75 * 200) / 87, 9);
    expect(back.loads.frontPct).toBeLessThan(even.loads.frontPct);
    expect(back.loads.frontPct).toBeCloseTo(31.53, 2);
  });
});

describe("stance model — tip-over thresholds", () => {
  it("the default stance endos at ~0.37 g — which is why riders nosedive", () => {
    const { thresholds: th } = computeState(p, s);
    expect(th.endoG).toBeCloseTo(350 / ((12 * 55 + 75 * 1089) / 87), 9);
    expect(th.endoG).toBeCloseTo(0.37, 2);
    // Below what the tyres could hold: the rider tips before the board skids.
    expect(th.endoG).toBeLessThan(TYPICAL_GRIP_G);
    expect(brakingLimit(th.endoG)).toBe("endo");
  });

  it("a centred CoM makes the two thresholds equal", () => {
    const th = computeState(p, s).thresholds;
    expect(th.endoG).toBeCloseTo(th.wheelieG, 9);
  });

  it("the two thresholds always sum to L/z_cm — the whole longitudinal budget", () => {
    const st = computeState(p, { ...s, weightSplitPct: 25, crouchPct: 40 });
    expect(st.thresholds.endoG + st.thresholds.wheelieG).toBeCloseTo(p.wheelbaseMm / st.com.zMm, 9);
    // A kart's budget is ~4 g (never reachable). A board's is under 1 g.
    expect(p.wheelbaseMm / st.com.zMm).toBeLessThan(1.1);
    expect(1040 / KART_TYPICAL_COG_MM).toBeGreaterThan(4);
  });

  it("weight back raises the endo threshold and lowers the wheelie threshold", () => {
    const even = computeState(p, s).thresholds;
    const back = computeState(p, { ...s, weightSplitPct: 20 }).thresholds;
    expect(back.endoG).toBeGreaterThan(even.endoG);
    expect(back.endoG).toBeCloseTo(0.5065, 3);
    expect(back.wheelieG).toBeLessThan(even.wheelieG);
  });

  it("crouching lowers the CoG and buys braking: 0.37 g → 0.48 g", () => {
    const up = computeState(p, s);
    const tucked = computeState(p, { ...s, crouchPct: 100 });
    expect(tucked.com.zMm).toBeLessThan(up.com.zMm);
    expect(tucked.thresholds.endoG).toBeCloseTo(0.476, 3);
    expect(tucked.thresholds.endoG / up.thresholds.endoG).toBeGreaterThan(1.25);
    // …and it does nothing to the static balance: crouching is a pure z move.
    expect(tucked.loads.frontPct).toBeCloseTo(up.loads.frontPct, 9);
  });

  it("raising the CoG lowers BOTH thresholds", () => {
    const tall = computeState({ ...p, riderHeightMm: 2000 }, s);
    const base = computeState(p, s);
    expect(tall.com.zMm).toBeGreaterThan(base.com.zMm);
    expect(tall.thresholds.endoG).toBeLessThan(base.thresholds.endoG);
    expect(tall.thresholds.wheelieG).toBeLessThan(base.thresholds.wheelieG);
  });

  it("a longer wheelbase raises the endo threshold at the same stance", () => {
    const longer = computeState({ ...p, wheelbaseMm: 900 }, s);
    const base = computeState(p, s);
    expect(longer.thresholds.endoG).toBeGreaterThan(base.thresholds.endoG);
  });

  it("crouchFactor is 1 stood up, 0.75 at a full tuck, and clamps", () => {
    expect(crouchFactor(0)).toBe(1);
    expect(crouchFactor(100)).toBeCloseTo(1 - CROUCH_COM_DROP, 12);
    expect(crouchFactor(-50)).toBe(1);
    expect(crouchFactor(500)).toBeCloseTo(1 - CROUCH_COM_DROP, 12);
  });

  it("a zero-height CoM has no tipping mode", () => {
    expect(thresholds({ xMm: 350, zMm: 0, massKg: 87 }, 700).endoG).toBe(Infinity);
  });
});

describe("stance model — load transfer", () => {
  it("zero accel reproduces the static loads", () => {
    const { com, loads } = computeState(p, s);
    const dyn = axleLoadsAtAccel(com, p.wheelbaseMm, 0);
    expect(dyn.frontKg).toBeCloseTo(loads.frontKg, 9);
    expect(dyn.rearKg).toBeCloseTo(loads.rearKg, 9);
  });

  it("the rear load is exactly zero AT the endo threshold (the definition)", () => {
    const { com, thresholds: th } = computeState(p, s);
    const dyn = axleLoadsAtAccel(com, p.wheelbaseMm, -th.endoG);
    expect(dyn.rearKg).toBeCloseTo(0, 9);
    expect(dyn.frontKg).toBeCloseTo(com.massKg, 9);
  });

  it("the front load is exactly zero AT the wheelie threshold", () => {
    const { com, thresholds: th } = computeState(p, s);
    const dyn = axleLoadsAtAccel(com, p.wheelbaseMm, th.wheelieG);
    expect(dyn.frontKg).toBeCloseTo(0, 9);
    expect(dyn.rearKg).toBeCloseTo(com.massKg, 9);
  });

  it("loads always sum to the total, even past the tipping point", () => {
    const { com } = computeState(p, s);
    const dyn = axleLoadsAtAccel(com, p.wheelbaseMm, -0.8);
    expect(dyn.frontKg + dyn.rearKg).toBeCloseTo(com.massKg, 9);
    expect(dyn.rearKg).toBeLessThan(0); // past the endo point: rear wheels are airborne
  });

  it("transfer is M·a·z/L and is ~5× a kart's for the same braking", () => {
    const { com } = computeState(p, s);
    expect(loadTransferKg(com, p.wheelbaseMm, -0.3)).toBeCloseTo((com.massKg * 0.3 * com.zMm) / p.wheelbaseMm, 9);
    const boardRatio = com.zMm / p.wheelbaseMm;
    const kartRatio = KART_TYPICAL_COG_MM / 1040;
    expect(boardRatio / kartRatio).toBeGreaterThan(4);
  });
});

describe("stance model — lateral", () => {
  it("lean angle is atan(a_y/g) and ignores CoG height", () => {
    expect(leanAngleDeg(0)).toBeCloseTo(0, 12);
    expect(leanAngleDeg(1)).toBeCloseTo(45, 9);
    expect(leanAngleDeg(0.5)).toBeCloseTo(26.565, 3);
  });
});

describe("stance model — figure IK", () => {
  const hip = { x: 350, z: 1000 };

  it("preserves both segment lengths when the foot is reachable", () => {
    const knee = solveKneeIK(hip, { x: 600, z: 110 }, 440, 510, 1);
    expect(Math.hypot(knee.x - hip.x, knee.z - hip.z)).toBeCloseTo(440, 9);
    expect(Math.hypot(knee.x - 600, knee.z - 110)).toBeCloseTo(510, 9);
  });

  it("bows the knee toward the end of the board the foot is on", () => {
    const front = solveKneeIK(hip, { x: 600, z: 110 }, 440, 510, 1);
    const rear = solveKneeIK(hip, { x: 100, z: 110 }, 440, 510, -1);
    const straightFront = hip.x + ((600 - hip.x) / Math.hypot(600 - hip.x, 110 - hip.z)) * 440;
    const straightRear = hip.x + ((100 - hip.x) / Math.hypot(100 - hip.x, 110 - hip.z)) * 440;
    expect(front.x).toBeGreaterThan(straightFront); // front knee toward the nose
    expect(rear.x).toBeLessThan(straightRear); // rear knee toward the tail
  });

  it("straightens the leg when the foot is out of reach", () => {
    const knee = solveKneeIK(hip, { x: hip.x + 2000, z: hip.z }, 440, 510, 1);
    expect(knee.x).toBeCloseTo(hip.x + 440, 9);
    expect(knee.z).toBeCloseTo(hip.z, 9);
  });

  it("a wider stance forces the hips down (the legs can't reach otherwise)", () => {
    const narrow = maxHipHeightAboveDeck(p, { ...s, frontFootXMm: 450, rearFootXMm: 250 }, 350);
    const wide = maxHipHeightAboveDeck(p, { ...s, frontFootXMm: 680, rearFootXMm: 20 }, 350);
    const legMm = 0.53 * p.riderHeightMm;
    expect(narrow).toBeLessThanOrEqual(legMm);
    expect(wide).toBeLessThan(narrow);
    // 350 mm of splay on a 943 mm leg: √(943² − 350²) ≈ 875.
    expect(maxHipHeightAboveDeck(p, { ...s, frontFootXMm: 700, rearFootXMm: 0 }, 350)).toBeCloseTo(
      Math.sqrt(legMm * legMm - 350 * 350),
      6,
    );
  });
});
