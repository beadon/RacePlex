// Pure rigid-body statics model for the kart seat-position visualizer.
//
// A kart has no suspension, so static axle loads are pure moments: track the
// longitudinal position (x) and height (z) of the combined centre of mass as
// the seat slides fore/aft and tilts about its front-bottom anchor, and every
// readout falls out of `front% = 100 · x_cm / wheelbase`.
//
// Coordinate system: origin at the rear-axle contact line, x positive toward
// the front axle, z up from the ground. All lengths in mm, masses in kg.
//
// The mass model is four elements:
//   - fixed lump   — chassis + engine + fuel, everything that never moves.
//     Its position is *solved* so that the zero point (slide 0, tilt 0) lands
//     exactly on the user's baseline front% / CoG height. The baseline is the
//     measured (or assumed) truth; the lump is virtual bookkeeping.
//   - seat         — moves rigidly with both adjustments.
//   - torso group  — pelvis/torso/head/arms (~66% of the driver), rigid with
//     the seat.
//   - leg group    — thighs/shanks/feet. The feet stay on the pedals, so the
//     leg CoM only follows a fraction `kLegs` of the hip's displacement (the
//     knees absorb the rest). This is the single biggest modelling choice and
//     why naive "whole CoG moves with the seat" estimates overstate the effect.

export interface Point {
  x: number;
  z: number;
}

export interface SeatModelParams {
  /** Rear axle (x=0) to front axle, mm. */
  wheelbaseMm: number;
  /** Driver mass incl. gear, kg. */
  driverMassKg: number;
  /** Kart mass incl. seat, excl. driver and fuel, kg. */
  kartMassKg: number;
  /** Seat mass (part of kartMassKg, but it moves), kg. */
  seatMassKg: number;
  /** Fuel load, kg. */
  fuelKg: number;
  /** Static front weight % at the zero point (slide 0, tilt 0). */
  baselineFrontPct: number;
  /** Combined CoG height at the zero point, mm. */
  baselineCogZMm: number;
  /** Fraction of seat/hip displacement the leg-group CoM follows (0..1). */
  kLegs: number;
  /** Fraction of driver mass in the seat-rigid torso group (rest is legs). */
  torsoFraction: number;
  /** Tilt anchor P — front-bottom seat edge / front mount bolt. */
  anchorXMm: number;
  anchorZMm: number;
  /** Torso-group CoM polar offset from the anchor (deg above +x axis). */
  torsoRMm: number;
  torsoAlphaDeg: number;
  /** Seat CoM offset from the anchor (dx, dz). */
  seatComDxMm: number;
  seatComDzMm: number;
  /** Hip point offset from the anchor (dx, dz) — drives the leg coupling. */
  hipDxMm: number;
  hipDzMm: number;
  /** Leg-group CoM at the zero point (absolute, fwd of rear axle). */
  legComXMm: number;
  legComZMm: number;
  /** Anchor → rear seat mount distance, mm (tilt mm ⇄ deg conversion). */
  rearMountArmMm: number;
  /** Rear track width, mm (lateral load-transfer readout). */
  trackWidthMm: number;
}

/** Seat adjustments relative to the zero point. */
export interface SeatAdjustments {
  /** Fore/aft slide, mm. Positive = forward. */
  slideMm: number;
  /** Tilt about the front anchor, deg. Positive = recline (driver back). */
  tiltDeg: number;
}

export interface MassElement {
  id: "fixed" | "seat" | "torso" | "legs";
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

export const ZERO_ADJUSTMENTS: SeatAdjustments = { slideMm: 0, tiltDeg: 0 };

/**
 * Defaults for a ~162 kg class weight (80 kg driver + 80 kg kart + 2 kg fuel)
 * sprint kart at a 43/57 baseline. Geometry puts the torso-group CoM up and
 * *behind* the front-bottom anchor, so recline moves it rearward AND down —
 * matching real seat-angle practice (a more reclined back lowers the CoG).
 */
export const DEFAULT_PARAMS: SeatModelParams = {
  wheelbaseMm: 1040,
  driverMassKg: 80,
  kartMassKg: 80,
  seatMassKg: 4,
  fuelKg: 2,
  baselineFrontPct: 43,
  baselineCogZMm: 250,
  kLegs: 0.4,
  torsoFraction: 0.66,
  anchorXMm: 330,
  anchorZMm: 60,
  torsoRMm: 450,
  torsoAlphaDeg: 115,
  seatComDxMm: -60,
  seatComDzMm: 140,
  hipDxMm: -40,
  hipDzMm: 120,
  legComXMm: 650,
  legComZMm: 150,
  rearMountArmMm: 300,
  trackWidthMm: 1200,
};

const DEG = Math.PI / 180;

/** Driver torso-group mass (rigid with the seat), kg. */
export function torsoMassKg(p: SeatModelParams): number {
  return p.torsoFraction * p.driverMassKg;
}

/** Driver leg-group mass, kg. */
export function legMassKg(p: SeatModelParams): number {
  return (1 - p.torsoFraction) * p.driverMassKg;
}

/** Total system mass, kg. */
export function totalMassKg(p: SeatModelParams): number {
  return p.kartMassKg + p.driverMassKg + p.fuelKg;
}

/**
 * Rotate an (dx, dz) offset by `deg` counter-clockwise in the x-forward /
 * z-up plane. Positive = recline: a point above the anchor moves rearward.
 */
export function rotateOffset(dx: number, dz: number, deg: number): Point {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** Hip point (absolute) at the given adjustments — rigid with the seat. */
export function hipPoint(p: SeatModelParams, adj: SeatAdjustments): Point {
  const r = rotateOffset(p.hipDxMm, p.hipDzMm, adj.tiltDeg);
  return { x: p.anchorXMm + adj.slideMm + r.x, z: p.anchorZMm + r.z };
}

/**
 * The virtual fixed lump (chassis + engine + fuel): mass is whatever isn't in
 * the moving groups; position is solved so the zero point reproduces the
 * baseline front% and CoG height exactly.
 */
export function solveFixedElement(p: SeatModelParams): MassElement {
  const M = totalMassKg(p);
  const mTorso = torsoMassKg(p);
  const mLegs = legMassKg(p);
  const mFixed = Math.max(M - mTorso - mLegs - p.seatMassKg, 0.001);

  const torso = rotateOffset(p.torsoRMm * Math.cos(p.torsoAlphaDeg * DEG), p.torsoRMm * Math.sin(p.torsoAlphaDeg * DEG), 0);
  const movingMomentX =
    mTorso * (p.anchorXMm + torso.x) +
    p.seatMassKg * (p.anchorXMm + p.seatComDxMm) +
    mLegs * p.legComXMm;
  const movingMomentZ =
    mTorso * (p.anchorZMm + torso.z) +
    p.seatMassKg * (p.anchorZMm + p.seatComDzMm) +
    mLegs * p.legComZMm;

  const targetXcm = (p.baselineFrontPct / 100) * p.wheelbaseMm;
  return {
    id: "fixed",
    massKg: mFixed,
    xMm: (targetXcm * M - movingMomentX) / mFixed,
    zMm: (p.baselineCogZMm * M - movingMomentZ) / mFixed,
  };
}

/** All four mass elements at the given adjustments. */
export function computeMassElements(p: SeatModelParams, adj: SeatAdjustments): MassElement[] {
  const anchorX = p.anchorXMm + adj.slideMm;
  const anchorZ = p.anchorZMm;

  const torsoOffset0: Point = {
    x: p.torsoRMm * Math.cos(p.torsoAlphaDeg * DEG),
    z: p.torsoRMm * Math.sin(p.torsoAlphaDeg * DEG),
  };
  const torsoOffset = rotateOffset(torsoOffset0.x, torsoOffset0.z, adj.tiltDeg);
  const seatOffset = rotateOffset(p.seatComDxMm, p.seatComDzMm, adj.tiltDeg);

  // Legs: the feet stay on the pedals, so the leg CoM follows only a fraction
  // of the hip's displacement (slide + tilt combined).
  const hip0 = hipPoint(p, ZERO_ADJUSTMENTS);
  const hip = hipPoint(p, adj);
  const legX = p.legComXMm + p.kLegs * (hip.x - hip0.x);
  const legZ = p.legComZMm + p.kLegs * (hip.z - hip0.z);

  return [
    solveFixedElement(p),
    { id: "seat", massKg: p.seatMassKg, xMm: anchorX + seatOffset.x, zMm: anchorZ + seatOffset.z },
    { id: "torso", massKg: torsoMassKg(p), xMm: anchorX + torsoOffset.x, zMm: anchorZ + torsoOffset.z },
    { id: "legs", massKg: legMassKg(p), xMm: legX, zMm: legZ },
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

/** Static axle loads from the CoM position (moments about the rear axle). */
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

export interface SeatModelState {
  elements: MassElement[];
  com: CoM;
  loads: AxleLoads;
}

/** Convenience: elements → CoM → axle loads for one (slide, tilt) point. */
export function computeState(p: SeatModelParams, adj: SeatAdjustments): SeatModelState {
  const elements = computeMassElements(p, adj);
  const com = computeCoM(elements);
  return { elements, com, loads: axleLoads(com, p.wheelbaseMm) };
}

/**
 * Local sensitivities at the current settings, by central difference (the
 * readout the spec asks for numerically, not from the linearization).
 */
export function sensitivity(p: SeatModelParams, adj: SeatAdjustments): { pctPerInch: number; pctPerDeg: number } {
  const hS = 5; // mm
  const fS1 = computeState(p, { ...adj, slideMm: adj.slideMm + hS }).loads.frontPct;
  const fS0 = computeState(p, { ...adj, slideMm: adj.slideMm - hS }).loads.frontPct;
  const hT = 0.25; // deg
  const fT1 = computeState(p, { ...adj, tiltDeg: adj.tiltDeg + hT }).loads.frontPct;
  const fT0 = computeState(p, { ...adj, tiltDeg: adj.tiltDeg - hT }).loads.frontPct;
  return {
    pctPerInch: ((fS1 - fS0) / (2 * hS)) * 25.4,
    pctPerDeg: (fT1 - fT0) / (2 * hT),
  };
}

/**
 * Closed-form slide sensitivity (%/mm) — Section 5 of the design doc. The
 * model is exactly linear in slide, so this matches the numeric value.
 */
export function slideSensitivityPctPerMm(p: SeatModelParams): number {
  const moved = torsoMassKg(p) + p.seatMassKg + p.kLegs * legMassKg(p);
  return (100 * moved) / (totalMassKg(p) * p.wheelbaseMm);
}

/**
 * Lateral load transfer (kg per side) at a given lateral acceleration —
 * `ΔW = M · a_y · z_cm / track`. Rigid-frame approximation: karts corner on
 * frame jacking, so treat this as a relative indicator, not gospel.
 */
export function lateralTransferKg(com: CoM, trackWidthMm: number, latG: number): number {
  return (com.massKg * latG * com.zMm) / trackWidthMm;
}

/** Most karts tilt via rear-mount spacers: mm the rear mount is LOWERED → recline deg. */
export function tiltDegFromRearMountMm(loweredMm: number, armMm: number): number {
  return Math.atan2(loweredMm, armMm) / DEG;
}

/** Inverse of `tiltDegFromRearMountMm`. */
export function rearMountMmFromTiltDeg(tiltDeg: number, armMm: number): number {
  return Math.tan(tiltDeg * DEG) * armMm;
}

/**
 * Two-link knee IK for the stick figure: knee position given hip and foot
 * (foot fixed on the pedals — this *is* the leg-coupling model made visible).
 * Picks the knee-up solution; clamps gracefully when the foot is out of reach.
 */
export function solveKneeIK(hip: Point, foot: Point, thighMm: number, shankMm: number): Point {
  const dx = foot.x - hip.x;
  const dz = foot.z - hip.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-9) return { x: hip.x + thighMm, z: hip.z };
  const ux = dx / d;
  const uz = dz / d;
  // Out of reach (or fully folded): put the knee on the hip→foot line.
  if (d >= thighMm + shankMm) return { x: hip.x + ux * thighMm, z: hip.z + uz * thighMm };
  if (d <= Math.abs(thighMm - shankMm)) return { x: hip.x + ux * thighMm, z: hip.z + uz * thighMm };
  const a = (thighMm * thighMm - shankMm * shankMm + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(thighMm * thighMm - a * a, 0));
  const bx = hip.x + ux * a;
  const bz = hip.z + uz * a;
  // Two solutions: base ± h·perpendicular. Knees point up in a kart.
  const k1 = { x: bx - uz * h, z: bz + ux * h };
  const k2 = { x: bx + uz * h, z: bz - ux * h };
  return k1.z >= k2.z ? k1 : k2;
}

/**
 * "Set current as zero": fold the live adjustments into the params so the
 * current seat position becomes the new baseline and the sliders re-read 0.
 * Exact — the returned params at zero adjustments reproduce the state the
 * old params had at `adj` (same front%, same CoG).
 */
export function rebaseline(p: SeatModelParams, adj: SeatAdjustments): SeatModelParams {
  const st = computeState(p, adj);
  const hip0 = hipPoint(p, ZERO_ADJUSTMENTS);
  const hip = hipPoint(p, adj);
  const seatR = rotateOffset(p.seatComDxMm, p.seatComDzMm, adj.tiltDeg);
  const hipR = rotateOffset(p.hipDxMm, p.hipDzMm, adj.tiltDeg);
  return {
    ...p,
    anchorXMm: p.anchorXMm + adj.slideMm,
    torsoAlphaDeg: p.torsoAlphaDeg + adj.tiltDeg,
    seatComDxMm: seatR.x,
    seatComDzMm: seatR.z,
    hipDxMm: hipR.x,
    hipDzMm: hipR.z,
    legComXMm: p.legComXMm + p.kLegs * (hip.x - hip0.x),
    legComZMm: p.legComZMm + p.kLegs * (hip.z - hip0.z),
    baselineFrontPct: st.loads.frontPct,
    baselineCogZMm: st.com.zMm,
  };
}

// ---------------------------------------------------------------------------
// Calibration (corner scales)
// ---------------------------------------------------------------------------

export interface CornerWeightsKg {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

/** Totals from a four-pad corner-scale reading. */
export function totalsFromCorners(c: CornerWeightsKg): { totalKg: number; frontKg: number; frontPct: number } {
  const frontKg = c.fl + c.fr;
  const totalKg = frontKg + c.rl + c.rr;
  return { totalKg, frontKg, frontPct: totalKg > 0 ? (100 * frontKg) / totalKg : 0 };
}

/**
 * Fit the leg-coupling factor from a known seat slide re-weighed on scales.
 * From Section 5: ΔW_front(kg) = s · (m_torso + m_seat + k·m_legs) / L, so
 *   k = (ΔW_front · L / s − m_torso − m_seat) / m_legs
 * Result is clamped to [0, 1] — outside that the measurement is suspect.
 */
export function fitKLegs(opts: {
  baselineFrontKg: number;
  movedFrontKg: number;
  /** Seat slide between the two weighings, mm (positive = forward). */
  slideMm: number;
  wheelbaseMm: number;
  torsoMassKg: number;
  seatMassKg: number;
  legMassKg: number;
}): number {
  const dFront = opts.movedFrontKg - opts.baselineFrontKg;
  const movedMass = (dFront * opts.wheelbaseMm) / opts.slideMm;
  const k = (movedMass - opts.torsoMassKg - opts.seatMassKg) / opts.legMassKg;
  return Math.min(1, Math.max(0, k));
}

export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB;
export const MM_PER_INCH = 25.4;
