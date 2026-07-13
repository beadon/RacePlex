// Pure rigid-body statics model for the eskate stance (foot-position) tool.
//
// This is the seat-position model's sibling, but the regime is completely
// different and that difference *is* the point of the tool:
//
//   kart    machine ~80 kg vs driver ~75 kg  · driver seated · CoG ~250 mm
//   eskate  board ~7–20 kg vs rider 50–120 kg · rider standing · CoG ~950 mm
//
// So on a board the rider is ~85% of the moving mass and stands nearly a metre
// up, over a 550–900 mm wheelbase. Foot placement doesn't nudge the balance the
// way a kart seat does — it *sets* it. And because z_cm/wheelbase is ~4× a
// kart's, the longitudinal tip-over thresholds land far lower than a car's.
//
// Whether a rider can actually REACH the endo threshold depends on which wheels
// brake — see `brakingCapability`. An eskate has no friction brakes: the BLDC
// motors are the brakes, so only driven wheels can slow the board. On a
// rear-driven board (nearly all of them) braking unloads the very axle doing the
// braking, and the rear breaks traction before the rear can lift. Those boards
// slide; they cannot endo under motor braking at all.
//
// Coordinate system (mirrors the kart model): origin at the REAR truck's contact
// line, x positive toward the front truck, z up from the ground. Lengths in mm,
// masses in kg. `g` only ever appears as a ratio, so every threshold is reported
// in g and the model never needs 9.81.

export interface Point {
  x: number;
  z: number;
}

/** The board + rider — the things you don't change between runs. */
export interface StanceParams {
  /** Rear truck (x=0) to front truck, mm. */
  wheelbaseMm: number;
  /** Deck standing surface above the ground, mm (drop-throughs are lower). */
  deckHeightMm: number;
  /** Board incl. battery, motors, enclosure, kg. */
  boardMassKg: number;
  /** Rider incl. helmet, pads, backpack, kg. */
  riderMassKg: number;
  /** Rider stature, mm. */
  riderHeightMm: number;
  /**
   * Which wheels the motors drive — and therefore which wheels can brake. An
   * eskate has no friction brakes. Nearly every board is dual-rear.
   */
  drivetrain: Drivetrain;
}

/** What the rider changes by standing differently. */
export interface StanceAdjustments {
  /** Front foot, mm forward of the rear truck. */
  frontFootXMm: number;
  /** Rear foot, mm forward of the rear truck (may be negative — over the tail). */
  rearFootXMm: number;
  /** % of rider weight carried on the FRONT foot (0–100). */
  weightSplitPct: number;
  /** 0 = stood up straight, 100 = deep tuck. */
  crouchPct: number;
}

export interface MassElement {
  id: "board" | "rider";
  massKg: number;
  xMm: number;
  zMm: number;
}

export interface CoM {
  xMm: number;
  zMm: number;
  massKg: number;
}

export interface AxleLoads {
  totalKg: number;
  frontKg: number;
  rearKg: number;
  frontPct: number;
  rearPct: number;
}

export interface Thresholds {
  /**
   * Braking decel at which the REAR wheels lift, g.
   *
   * Pure geometry — it does not care where the decelerating force comes from.
   * On a rear-driven board the motors cannot reach it (`brakingCapability`);
   * a kerb, a pothole or a nose-first impact can.
   */
  endoG: number;
  /** Forward accel at which the FRONT wheels lift, g. */
  wheelieG: number;
}

/**
 * Standing whole-body CoM height ≈ 0.55 × stature above the soles. Winter,
 * *Biomechanics and Motor Control of Human Movement* (4th ed., Table 4.1) puts
 * the whole-body CoM at 0.553·H for a standing adult; 0.55 is the usual working
 * figure and the ±1% spread between sources is far below the error in guessing a
 * rider's mass.
 */
export const STANDING_COM_FRACTION = 0.55;

/**
 * Fraction of the rider's standing CoM height (above the deck) that a full tuck
 * removes. A deep athletic crouch drops the whole-body CoM from ~0.55·H to
 * ~0.41·H, i.e. about a quarter — the knees do the work, the CoM comes down with
 * the hips. This is the single knob that most changes the crash thresholds.
 */
export const CROUCH_COM_DROP = 0.25;

/**
 * Board CoM height as a fraction of deck height. The battery enclosure hangs
 * under the deck and the motors sit at axle height, so the board's own CoM is
 * roughly halfway up. It barely matters: the board is ~15% of the mass and sits
 * ~5% of the rider's height, so a 30 mm error here moves the combined CoG by
 * under 5 mm.
 */
export const BOARD_COM_Z_FRACTION = 0.5;


/**
 * Longitudinal grip a decent urethane setup gets on dry asphalt, g. Rough, but
 * enough to answer the question that matters: does the board pitch before it
 * slides? On a rear-driven board, never — see `brakingCapability`.
 */
export const TYPICAL_GRIP_G = 0.6;

/**
 * A 700 mm-wheelbase board, 110 mm deck, 12 kg, 75 kg rider at 1.78 m, feet just
 * inboard of the trucks, even split, stood up straight. Rider is 86% of the
 * moving mass — the regime this tool exists to show.
 */
export const DEFAULT_PARAMS: StanceParams = {
  wheelbaseMm: 700,
  deckHeightMm: 110,
  boardMassKg: 12,
  riderMassKg: 75,
  riderHeightMm: 1780,
  drivetrain: "dualRear",
};

export const DEFAULT_STANCE: StanceAdjustments = {
  frontFootXMm: 600,
  rearFootXMm: 100,
  weightSplitPct: 50,
  crouchPct: 0,
};

/** Total moving mass, kg. */
export function totalMassKg(p: StanceParams): number {
  return p.boardMassKg + p.riderMassKg;
}

/** Rider's share of the moving mass, % — ~85 on a board, ~48 on a kart. */
export function riderMassFractionPct(p: StanceParams): number {
  const m = totalMassKg(p);
  return m > 0 ? (100 * p.riderMassKg) / m : 0;
}

/** 1 = stood up, 0.75 = deep tuck. Multiplies the CoM height above the deck. */
export function crouchFactor(crouchPct: number): number {
  const c = Math.min(Math.max(crouchPct, 0), 100) / 100;
  return 1 - CROUCH_COM_DROP * c;
}

/**
 * Rider CoM. Longitudinally it sits where the weight is: the two feet are the
 * only contact with the board, so their loads must sum to the rider's weight and
 * their moments must balance about the CoM — which puts the CoM at the
 * load-weighted mean of the two foot positions. Vertically it's the
 * anthropometric 0.55·H above the soles (i.e. above the deck), pulled down by
 * the crouch.
 *
 * Ignored: the extra CoM drop from a very wide stance splaying the legs (the
 * diagram has to show it, because the feet must land on the deck, but it's a few
 * percent of z and it isn't worth the coupling here).
 */
export function riderCoM(p: StanceParams, a: StanceAdjustments): Point {
  const split = Math.min(Math.max(a.weightSplitPct, 0), 100) / 100;
  return {
    x: a.frontFootXMm * split + a.rearFootXMm * (1 - split),
    z: p.deckHeightMm + STANDING_COM_FRACTION * p.riderHeightMm * crouchFactor(a.crouchPct),
  };
}

/** Board CoM: mid-wheelbase, about half deck height (see BOARD_COM_Z_FRACTION). */
export function boardCoM(p: StanceParams): Point {
  return { x: p.wheelbaseMm / 2, z: p.deckHeightMm * BOARD_COM_Z_FRACTION };
}

/** The two mass elements at the given stance. */
export function computeMassElements(p: StanceParams, a: StanceAdjustments): MassElement[] {
  const rider = riderCoM(p, a);
  const board = boardCoM(p);
  return [
    { id: "board", massKg: p.boardMassKg, xMm: board.x, zMm: board.z },
    { id: "rider", massKg: p.riderMassKg, xMm: rider.x, zMm: rider.z },
  ];
}

/** Combined centre of mass of a set of elements. */
export function computeCoM(elements: MassElement[]): CoM {
  let m = 0;
  let mx = 0;
  let mz = 0;
  for (const e of elements) {
    m += e.massKg;
    mx += e.massKg * e.xMm;
    mz += e.massKg * e.zMm;
  }
  return { xMm: mx / m, zMm: mz / m, massKg: m };
}

/**
 * Static wheel loads. Moments about the rear contact line: N_f·L = M·g·x_cm, so
 * front% = 100·x_cm/L — same one-liner as the kart, and the reason the two tools
 * agree on their first readout.
 */
export function axleLoads(com: CoM, wheelbaseMm: number): AxleLoads {
  const frontKg = (com.massKg * com.xMm) / wheelbaseMm;
  const frontPct = (100 * com.xMm) / wheelbaseMm;
  return {
    totalKg: com.massKg,
    frontKg,
    rearKg: com.massKg - frontKg,
    frontPct,
    rearPct: 100 - frontPct,
  };
}

/**
 * Wheel loads under a longitudinal acceleration `aG` (in g; positive = throttle,
 * negative = braking).
 *
 * D'Alembert in the board frame: an inertial force M·a acts at the CoM, opposing
 * the acceleration. Moments about the REAR contact line (x=0, z=0):
 *
 *     N_f·L  −  M·g·x_cm  +  M·a·z_cm  =  0
 *     N_f = M·(g·x_cm − a·z_cm) / L        → in kgf:  M·(x_cm − aG·z_cm) / L
 *
 * and N_r = M − N_f by vertical equilibrium. Under braking aG < 0, so the front
 * gains M·|aG|·z_cm/L and the rear sheds the same — that quantity is the load
 * transfer, and it scales with z_cm/L, which on a board is ~1.35 (a kart's is
 * ~0.24). Same brake, five times the transfer.
 *
 * A negative load means that wheel pair is in the air; the numbers stay signed so
 * callers can see how far past the tipping point they are.
 */
export function axleLoadsAtAccel(com: CoM, wheelbaseMm: number, aG: number): AxleLoads {
  const frontKg = (com.massKg * (com.xMm - aG * com.zMm)) / wheelbaseMm;
  const rearKg = com.massKg - frontKg;
  return {
    totalKg: com.massKg,
    frontKg,
    rearKg,
    frontPct: (100 * frontKg) / com.massKg,
    rearPct: (100 * rearKg) / com.massKg,
  };
}

/** Load moved off the rear onto the front (kgf) at a braking decel of `aG` g. */
export function loadTransferKg(com: CoM, wheelbaseMm: number, aG: number): number {
  return (com.massKg * Math.abs(aG) * com.zMm) / wheelbaseMm;
}

/**
 * The two tip-over thresholds.
 *
 * ENDO (nosedive) — the rear lifts. Moments about the FRONT contact line (x=L),
 * braking at decel a (inertial force M·a pointing forward, at height z_cm):
 *
 *     N_r·L  =  M·g·(L − x_cm)  −  M·a·z_cm
 *     N_r = 0  ⇒  a = g·(L − x_cm) / z_cm
 *
 * WHEELIE — the front lifts. From N_f above:
 *
 *     N_f = 0  ⇒  a = g·x_cm / z_cm
 *
 * Both are pure geometry: the ratio of the horizontal distance from the CoM to
 * the contact line it pivots about, over the CoM height. Note they sum to
 * g·L/z_cm — the whole longitudinal budget a vehicle has. A kart's is ~4.2 g
 * (unreachable, so a kart never tips lengthways). A board's is ~0.74 g, split
 * between the two ends: wherever you stand, one of the two thresholds is inside
 * what the brakes and tyres can deliver.
 */
export function thresholds(com: CoM, wheelbaseMm: number): Thresholds {
  if (com.zMm <= 0) return { endoG: Infinity, wheelieG: Infinity };
  return {
    endoG: (wheelbaseMm - com.xMm) / com.zMm,
    wheelieG: com.xMm / com.zMm,
  };
}

/**
 * The whole longitudinal budget, g·L/z_cm — which is exactly `endoG + wheelieG`.
 *
 * This is the number a rider can act on. Moving your feet slides the budget
 * between the two ends and never changes its size: buy braking at the nose and
 * you pay for it at the tail. Only lowering the CoM (crouch) or riding a longer
 * wheelbase makes the budget itself bigger.
 */
export function longitudinalBudgetG(com: CoM, wheelbaseMm: number): number {
  if (com.zMm <= 0) return Infinity;
  return wheelbaseMm / com.zMm;
}

/**
 * How the board is braked. An eskate has no friction brakes: the BLDC motors are
 * the brakes, so only the wheels a motor drives can slow the board down.
 */
export type Drivetrain = "singleRear" | "dualRear" | "allWheel";

/** Share of the REAR axle's normal load a drivetrain can brake against. */
const REAR_BRAKED_FRACTION: Record<Drivetrain, number> = {
  singleRear: 0.5, // one of the two rear wheels
  dualRear: 1, // both rear wheels
  allWheel: 1, // (unused — all-wheel is handled separately)
};

export interface BrakingCapability {
  /** The hardest the board can actually stop, g. */
  maxDecelG: number;
  /** What runs out first: the rider pitches (`endo`) or the wheels slide (`slip`). */
  limit: "endo" | "slip";
  /** Whether braking alone can ever reach the endo threshold. */
  endoReachable: boolean;
}

/**
 * The deceleration the board can actually produce, and what stops it going
 * harder. This is the part that depends on WHERE the brakes are.
 *
 * Load transfer itself does not: ΔW = M·a·z/L no matter which wheels brake. But
 * the *force* is capped by friction on the braked wheels only, and their normal
 * load moves as you brake.
 *
 * REAR-DRIVEN (nearly every eskate — one or two rear motors). Braking unloads
 * the rear, which is the axle doing the braking:
 *
 *     M·a = μ·f·N_r = μ·f·M·( g(L − x_cm)/L − a·z_cm/L )
 *     ⇒   a = μ·f·(L − x_cm) / (L + μ·f·z_cm)
 *
 * Compare that to the endo threshold g·(L − x_cm)/z_cm:
 *
 *     a_slip / a_endo  =  μ·f·z_cm / (L + μ·f·z_cm)  <  1     for all μ, f, L, z > 0
 *
 * It is less than 1 for *every* board, always. **A rear-driven board cannot endo
 * under motor braking.** As the rear unloads it loses the very grip it needs to
 * brake, so it can never catch the threshold — the rear breaks traction and the
 * board slides instead. With the defaults it tops out around 0.17 g, under half
 * the 0.37 g that would lift the rear.
 *
 * The endo threshold is still real: a kerb, a pothole or a nose-first impact
 * applies the decelerating force without needing rear grip. It just isn't
 * something the motors can do to you.
 *
 * ALL-WHEEL. Every wheel brakes, so the whole weight is available whatever the
 * transfer, and a_max = μ·g. Here the endo threshold IS reachable when it lands
 * below μ (0.37 g vs 0.6 g on the defaults) — you pitch before you skid.
 */
export function brakingCapability(
  com: CoM,
  wheelbaseMm: number,
  drivetrain: Drivetrain,
  gripG: number = TYPICAL_GRIP_G,
): BrakingCapability {
  const endoG = thresholds(com, wheelbaseMm).endoG;

  if (drivetrain === "allWheel") {
    const endoFirst = endoG <= gripG;
    return {
      maxDecelG: Math.min(endoG, gripG),
      limit: endoFirst ? "endo" : "slip",
      endoReachable: endoFirst,
    };
  }

  const f = REAR_BRAKED_FRACTION[drivetrain];
  const slipG =
    (gripG * f * (wheelbaseMm - com.xMm)) / (wheelbaseMm + gripG * f * com.zMm);

  // Provably below endoG (see above), so the rear always slides first.
  return { maxDecelG: slipG, limit: "slip", endoReachable: false };
}

/**
 * Lean angle a rider must hold to sustain `latG` of cornering: θ = atan(a_y/g).
 *
 * Deliberately NOT the kart's lateral-transfer readout. A kart is rigid, so
 * lateral g tries to roll it over its track. A rider *leans*, putting the CoM
 * back over the contact patches, so a board's lateral limit is grip (and the
 * bushings), not tip-over — and lean angle, unlike transfer, doesn't depend on
 * CoG height at all.
 */
export function leanAngleDeg(latG: number): number {
  return (Math.atan(latG) * 180) / Math.PI;
}

export interface StanceState {
  elements: MassElement[];
  com: CoM;
  loads: AxleLoads;
  thresholds: Thresholds;
}

/** Convenience: elements → CoM → loads → thresholds for one stance. */
export function computeState(p: StanceParams, a: StanceAdjustments): StanceState {
  const elements = computeMassElements(p, a);
  const com = computeCoM(elements);
  return {
    elements,
    com,
    loads: axleLoads(com, p.wheelbaseMm),
    thresholds: thresholds(com, p.wheelbaseMm),
  };
}

// ---------------------------------------------------------------------------
// Figure geometry (visual only — the mass model above does not depend on it)
// ---------------------------------------------------------------------------

/**
 * Segment lengths as fractions of stature (Winter, Table 4.1 / Drillis &
 * Contini): knee height 0.285·H, greater trochanter 0.530·H, shoulder 0.818·H.
 * So sole→knee = 0.285·H, knee→hip = 0.245·H, hip→shoulder = 0.288·H.
 */
export const SHANK_FRACTION = 0.285;
export const THIGH_FRACTION = 0.245;
export const TORSO_FRACTION = 0.288;
export const HEAD_R_FRACTION = 0.065;
/** Hip height when stood up straight (= shank + thigh, as it must be). */
export const HIP_FRACTION = SHANK_FRACTION + THIGH_FRACTION;
/** Hip drop at a full tuck, as a fraction of standing hip height. The hips fold
 * further than the CoM does (the torso pitches forward and takes up the slack). */
export const CROUCH_HIP_DROP = 0.3;

/**
 * Two-link IK for one leg: knee position given the hip and the foot. The rider
 * stands across the board, so a side view of the board is a *front* view of the
 * rider — both legs are in frame, splayed from one hip pair down to two feet,
 * and the knees bow outward (toward the end of the board each foot is on).
 * Hence `bow`: +1 puts the knee on the nose side, −1 on the tail side.
 *
 * Clamps onto the hip→foot line when the foot is out of reach (a straight leg),
 * which is what a wide stance actually looks like.
 */
export function solveKneeIK(hip: Point, foot: Point, thighMm: number, shankMm: number, bow: 1 | -1): Point {
  const dx = foot.x - hip.x;
  const dz = foot.z - hip.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-9) return { x: hip.x + bow * thighMm, z: hip.z };
  const ux = dx / d;
  const uz = dz / d;
  if (d >= thighMm + shankMm || d <= Math.abs(thighMm - shankMm)) {
    return { x: hip.x + ux * thighMm, z: hip.z + uz * thighMm };
  }
  const a = (thighMm * thighMm - shankMm * shankMm + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(thighMm * thighMm - a * a, 0));
  const bx = hip.x + ux * a;
  const bz = hip.z + uz * a;
  // Two mirror solutions about the hip→foot line; pick the one on the `bow` side.
  const k1 = { x: bx - uz * h, z: bz + ux * h };
  const k2 = { x: bx + uz * h, z: bz - ux * h };
  return (k1.x - k2.x) * bow > 0 ? k1 : k2;
}

export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB;

/**
 * Highest the hip can sit and still have both feet on the deck: for each leg,
 * √(legLength² − Δx²) above the foot. A wide stance forces the hips down — the
 * legs simply can't reach any other way — so the figure gets shorter as the
 * stance widens even at zero crouch.
 */
export function maxHipHeightAboveDeck(p: StanceParams, a: StanceAdjustments, hipX: number): number {
  const leg = (SHANK_FRACTION + THIGH_FRACTION) * p.riderHeightMm;
  const reach = (footX: number) => {
    const dx = Math.abs(footX - hipX);
    return dx >= leg ? 0 : Math.sqrt(leg * leg - dx * dx);
  };
  return Math.min(reach(a.frontFootXMm), reach(a.rearFootXMm));
}
