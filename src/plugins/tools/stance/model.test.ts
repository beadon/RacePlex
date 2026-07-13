import { describe, it, expect } from "vitest";
import {
  BOARD_COM_Z_FRACTION,
  CROUCH_COM_DROP,
  DEFAULT_PARAMS,
  DEFAULT_STANCE,
  longitudinalBudgetG,
  STANDING_COM_FRACTION,
  TYPICAL_GRIP_G,
  axleLoads,
  axleLoadsAtAccel,
  boardCoM,
  brakingCapability,
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

  it("the rider is ~86% of the moving mass — the regime the tool exists for", () => {
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

  it("combined CoG is ~946 mm — higher than the wheelbase is long", () => {
    // z_cm = (12·55 + 75·1089) / 87
    const { com } = computeState(p, s);
    expect(com.zMm).toBeCloseTo((12 * 55 + 75 * 1089) / 87, 9);
    expect(com.zMm).toBeCloseTo(946.38, 2);
    // The whole reason a board endos: the CoG stands taller than the wheelbase,
    // so z/L > 1 and the longitudinal budget drops under 1 g.
    expect(com.zMm).toBeGreaterThan(p.wheelbaseMm);
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
    // Reachable only when every wheel brakes. See the drivetrain block below.
    expect(brakingCapability(computeState(p, s).com, p.wheelbaseMm, "allWheel").limit).toBe("endo");
  });

  it("a centred CoM makes the two thresholds equal", () => {
    const th = computeState(p, s).thresholds;
    expect(th.endoG).toBeCloseTo(th.wheelieG, 9);
  });

  it("the two thresholds always sum to L/z_cm — the whole longitudinal budget", () => {
    const st = computeState(p, { ...s, weightSplitPct: 25, crouchPct: 40 });
    const budget = longitudinalBudgetG(st.com, p.wheelbaseMm);
    expect(st.thresholds.endoG + st.thresholds.wheelieG).toBeCloseTo(budget, 9);
    expect(budget).toBeCloseTo(p.wheelbaseMm / st.com.zMm, 9);
    // Under 1 g, so at least one end is always inside what the board can pull.
    expect(budget).toBeLessThan(1.1);
  });

  it("moving your feet re-splits the budget without changing its size", () => {
    // The claim the readout makes: stance slides the budget, crouch grows it.
    const back = computeState(p, { ...s, weightSplitPct: 10 });
    const fwd = computeState(p, { ...s, weightSplitPct: 90 });
    const backBudget = longitudinalBudgetG(back.com, p.wheelbaseMm);
    const fwdBudget = longitudinalBudgetG(fwd.com, p.wheelbaseMm);

    // Same size (z_cm doesn't move when only the split changes) ...
    expect(backBudget).toBeCloseTo(fwdBudget, 9);
    // ... but split differently: weight back buys braking, costs you the wheelie.
    expect(back.thresholds.endoG).toBeGreaterThan(fwd.thresholds.endoG);
    expect(back.thresholds.wheelieG).toBeLessThan(fwd.thresholds.wheelieG);

    // Crouching is the only thing that makes the budget itself bigger.
    const tucked = computeState(p, { ...s, crouchPct: 100 });
    expect(longitudinalBudgetG(tucked.com, p.wheelbaseMm)).toBeGreaterThan(backBudget);
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

  it("transfer is M·a·z/L, and z/L > 1 means it exceeds the braking force itself", () => {
    const { com } = computeState(p, s);
    expect(loadTransferKg(com, p.wheelbaseMm, -0.3)).toBeCloseTo((com.massKg * 0.3 * com.zMm) / p.wheelbaseMm, 9);
    // z/L > 1, so a 0.3 g stop shifts MORE than 0.3 of the mass forward.
    expect(com.zMm / p.wheelbaseMm).toBeGreaterThan(1);
    expect(loadTransferKg(com, p.wheelbaseMm, -0.3)).toBeGreaterThan(0.3 * com.massKg);
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

describe("brakingCapability — an eskate's brakes are its motors", () => {
  const p = DEFAULT_PARAMS;
  const s = DEFAULT_STANCE;

  it("a rear-driven board slides long before the rear can lift", () => {
    const { com } = computeState(p, s);
    const cap = brakingCapability(com, p.wheelbaseMm, "dualRear");
    const { endoG } = thresholds(com, p.wheelbaseMm);

    expect(cap.limit).toBe("slip");
    expect(cap.endoReachable).toBe(false);
    expect(cap.maxDecelG).toBeCloseTo(0.166, 2);
    // Under half the decel that would lift the rear.
    expect(cap.maxDecelG).toBeLessThan(endoG / 2);
  });

  it("closed form: a = μf(L − x) / (L + μfz)", () => {
    const { com } = computeState(p, s);
    const mu = TYPICAL_GRIP_G;
    const expected = (mu * 1 * (p.wheelbaseMm - com.xMm)) / (p.wheelbaseMm + mu * 1 * com.zMm);
    expect(brakingCapability(com, p.wheelbaseMm, "dualRear").maxDecelG).toBeCloseTo(expected, 12);
  });

  it("one rear motor brakes against half the rear axle, so it slides even sooner", () => {
    const { com } = computeState(p, s);
    const one = brakingCapability(com, p.wheelbaseMm, "singleRear").maxDecelG;
    const two = brakingCapability(com, p.wheelbaseMm, "dualRear").maxDecelG;
    expect(one).toBeLessThan(two);
    expect(one).toBeCloseTo(0.107, 2);
  });

  it("NO rear-driven board can ever endo under motor braking — for any geometry", () => {
    // a_slip/a_endo = μfz/(L + μfz) < 1 identically. Sweep the space to prove the
    // claim isn't an artefact of the default numbers.
    for (const wheelbaseMm of [400, 550, 700, 900, 1200]) {
      for (const riderHeightMm of [1400, 1780, 2100]) {
        for (const grip of [0.3, 0.6, 1.2, 2.0]) {
          for (const crouchPct of [0, 50, 100]) {
            for (const weightSplitPct of [0, 35, 50, 80, 100]) {
              const params = { ...p, wheelbaseMm, riderHeightMm };
              // Feet scale with the board. A foot beyond the truck isn't a board.
              const stance = {
                ...s,
                rearFootXMm: 0.15 * wheelbaseMm,
                frontFootXMm: 0.85 * wheelbaseMm,
                crouchPct,
                weightSplitPct,
              };
              const { com } = computeState(params, stance);
              const { endoG } = thresholds(com, wheelbaseMm);
              expect(endoG).toBeGreaterThan(0); // the geometry is a real board
              for (const dt of ["singleRear", "dualRear"] as const) {
                const cap = brakingCapability(com, wheelbaseMm, dt, grip);
                expect(cap.endoReachable).toBe(false);
                expect(cap.limit).toBe("slip");
                expect(cap.maxDecelG).toBeLessThan(endoG);
              }
            }
          }
        }
      }
    }
  });

  it("all-wheel braking uses the whole weight, so it CAN reach the endo", () => {
    const { com } = computeState(p, s);
    const cap = brakingCapability(com, p.wheelbaseMm, "allWheel");
    const { endoG } = thresholds(com, p.wheelbaseMm);

    expect(endoG).toBeLessThan(TYPICAL_GRIP_G); // 0.37 g vs 0.6 g of grip
    expect(cap.limit).toBe("endo");
    expect(cap.endoReachable).toBe(true);
    expect(cap.maxDecelG).toBeCloseTo(endoG, 9);
  });

  it("all-wheel on a board that can't pitch: grip binds instead", () => {
    // Low CoM + long wheelbase pushes the endo above the grip limit.
    const params = { ...p, wheelbaseMm: 1200, riderHeightMm: 1400 };
    const { com } = computeState(params, { ...s, frontFootXMm: 1100, crouchPct: 100 });
    const cap = brakingCapability(com, params.wheelbaseMm, "allWheel");
    expect(cap.limit).toBe("slip");
    expect(cap.maxDecelG).toBeCloseTo(TYPICAL_GRIP_G, 9);
  });
});
