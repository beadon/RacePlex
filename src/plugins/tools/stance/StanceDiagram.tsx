// Side view of the board with a standing stick rider.
//
// The rider stands ACROSS the board, so a side view of the board is a front view
// of the rider: both legs are in frame, splayed from the hips down to the two
// foot positions, and the torso rises vertically (a rider's fore/aft lean is out
// of this plane). Feet are pinned to the foot-position sliders and the hips drop
// as the stance widens or the rider tucks — the legs simply can't reach any other
// way, which is the geometry the crouch slider is trading on.
//
// Drawn to scale, deliberately: the whole message of this tool is how far above a
// 700 mm wheelbase the rider's mass actually sits. The dimension line on the left
// The CoG height is dimensioned against the board, which is the thing the
// rider can actually change (by crouching).

import { useMemo } from "react";
import { useToolsT } from "../i18n";
import {
  CROUCH_HIP_DROP,
  HEAD_R_FRACTION,
  HIP_FRACTION,
  SHANK_FRACTION,
  THIGH_FRACTION,
  TORSO_FRACTION,
  computeCoM,
  computeMassElements,
  maxHipHeightAboveDeck,
  riderCoM,
  solveKneeIK,
  type Point,
  type StanceAdjustments,
  type StanceParams,
} from "./model";

type ToolsT = ReturnType<typeof useToolsT>;

/** Deck overhang past each truck (nose/tail), mm — visual only. */
const OVERHANG_MM = 110;
/** Half-length of a foot mark, mm. */
const FOOT_HALF_MM = 48;
/** The CoG dimension line's x, and the gutter left of it its labels need. */
const DIM_LINE_X = -(OVERHANG_MM + 190);
const DIM_GUTTER_MM = 620;
/** Neck gap between the shoulder and the head circle, as a fraction of stature. */
const HEAD_GAP_FRACTION = 0.02;

interface FigureGeometry {
  hip: Point;
  frontFoot: Point;
  rearFoot: Point;
  frontKnee: Point;
  rearKnee: Point;
  shoulder: Point;
  head: Point;
  headR: number;
  hands: [Point, Point];
  com: Point;
  frontShare: number;
}

function buildFigure(p: StanceParams, a: StanceAdjustments): FigureGeometry {
  const H = p.riderHeightMm;
  const deck = p.deckHeightMm;
  const thigh = THIGH_FRACTION * H;
  const shank = SHANK_FRACTION * H;

  // The hips sit over the rider's CoM (that's what the weight split means), and
  // as high as the crouch AND the leg reach allow — whichever binds first.
  const hipX = riderCoM(p, a).x;
  const wanted = HIP_FRACTION * H * (1 - CROUCH_HIP_DROP * Math.min(Math.max(a.crouchPct, 0), 100) / 100);
  const reachable = maxHipHeightAboveDeck(p, a, hipX) * 0.985; // a hair of knee bend, always
  const hip: Point = { x: hipX, z: deck + Math.min(wanted, reachable) };

  const frontFoot: Point = { x: a.frontFootXMm, z: deck };
  const rearFoot: Point = { x: a.rearFootXMm, z: deck };
  const frontKnee = solveKneeIK(hip, frontFoot, thigh, shank, 1);
  const rearKnee = solveKneeIK(hip, rearFoot, thigh, shank, -1);

  const shoulder: Point = { x: hipX, z: hip.z + TORSO_FRACTION * H };
  const headR = HEAD_R_FRACTION * H;
  const head: Point = { x: hipX, z: shoulder.z + headR + HEAD_GAP_FRACTION * H };
  // Arms out for balance — in this projection they read as splay, not reach.
  const hands: [Point, Point] = [
    { x: hipX + 0.19 * H, z: shoulder.z - 0.14 * H },
    { x: hipX - 0.19 * H, z: shoulder.z - 0.14 * H },
  ];

  const com = computeCoM(computeMassElements(p, a));
  return {
    hip,
    frontFoot,
    rearFoot,
    frontKnee,
    rearKnee,
    shoulder,
    head,
    headR,
    hands,
    com: { x: com.xMm, z: com.zMm },
    frontShare: Math.min(Math.max(a.weightSplitPct, 0), 100) / 100,
  };
}

function Board({ p, wheelR }: { p: StanceParams; wheelR: number }) {
  const L = p.wheelbaseMm;
  const d = p.deckHeightMm;
  const deckPts = [
    [-OVERHANG_MM, d + 30],
    [-OVERHANG_MM * 0.55, d],
    [L + OVERHANG_MM * 0.55, d],
    [L + OVERHANG_MM, d + 30],
  ] as const;
  return (
    <g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <polyline
        className="text-primary"
        points={deckPts.map(([x, z]) => `${x},${-z}`).join(" ")}
        strokeWidth={16}
      />
      {/* trucks: baseplate under the deck down to the axle */}
      <g className="text-muted-foreground" strokeWidth={12}>
        <line x1={0} y1={-d + 8} x2={0} y2={-wheelR} />
        <line x1={L} y1={-d + 8} x2={L} y2={-wheelR} />
      </g>
      {/* wheels */}
      <g className="text-foreground/70" strokeWidth={11}>
        <circle cx={0} cy={-wheelR} r={wheelR} />
        <circle cx={L} cy={-wheelR} r={wheelR} />
      </g>
    </g>
  );
}

function Figure({ g }: { g: FigureGeometry }) {
  const pts = (list: Point[]) => list.map((q) => `${q.x},${-q.z}`).join(" ");
  return (
    <g className="text-foreground" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* legs: foot → knee → hip, one per foot */}
      <polyline points={pts([g.rearFoot, g.rearKnee, g.hip])} strokeWidth={22} />
      <polyline points={pts([g.frontFoot, g.frontKnee, g.hip])} strokeWidth={22} />
      {/* torso stays vertical: the rider's fore/aft lean is out of this plane */}
      <line x1={g.hip.x} y1={-g.hip.z} x2={g.shoulder.x} y2={-g.shoulder.z} strokeWidth={26} />
      <polyline points={pts([g.hands[1], g.shoulder, g.hands[0]])} strokeWidth={14} />
      <circle cx={g.head.x} cy={-g.head.z} r={g.headR} strokeWidth={14} />
    </g>
  );
}

/** Foot marks, sized by how much of the rider's weight each one carries. */
function Feet({ g, deckZ }: { g: FigureGeometry; deckZ: number }) {
  const foot = (at: Point, share: number, key: string) => (
    <line
      key={key}
      x1={at.x - FOOT_HALF_MM}
      y1={-deckZ - 12}
      x2={at.x + FOOT_HALF_MM}
      y2={-deckZ - 12}
      stroke="currentColor"
      strokeWidth={10 + 26 * share}
      strokeLinecap="round"
      opacity={0.4 + 0.6 * share}
    />
  );
  return (
    <g className="text-warning">
      {foot(g.rearFoot, 1 - g.frontShare, "rear")}
      {foot(g.frontFoot, g.frontShare, "front")}
    </g>
  );
}

/** CoM crosshair plus the plumb line to the ground — where the weight lands. */
function ComMarker({ at }: { at: Point }) {
  return (
    <g className="text-warning" stroke="currentColor" fill="none">
      <line x1={at.x} y1={-at.z} x2={at.x} y2={0} strokeWidth={5} strokeDasharray="26 20" opacity={0.75} />
      <circle cx={at.x} cy={-at.z} r={30} strokeWidth={7} />
      <line x1={at.x - 46} y1={-at.z} x2={at.x + 46} y2={-at.z} strokeWidth={7} />
      <line x1={at.x} y1={-at.z - 46} x2={at.x} y2={-at.z + 46} strokeWidth={7} />
      <line x1={at.x} y1={-34} x2={at.x} y2={34} strokeWidth={9} />
    </g>
  );
}

/**
 * Vertical dimension line for the CoG height. This is the readout the whole tool
 * is built around, and it reads better as a picture than as a number.
 */
function CogDimension({ zMm, x }: { zMm: number; x: number }) {
  const tick = 46;
  return (
    <>
      <g className="text-warning" stroke="currentColor" fill="currentColor" strokeWidth={6}>
        <line x1={x} y1={0} x2={x} y2={-zMm} />
        <line x1={x - tick} y1={-zMm} x2={x + tick} y2={-zMm} />
        <line x1={x - tick} y1={0} x2={x + tick} y2={0} />
        <text x={x - 20} y={-zMm / 2} stroke="none" fontSize={62} textAnchor="end" dominantBaseline="middle">
          {Math.round(zMm)} mm
        </text>
      </g>
    </>
  );
}

export function StanceDiagram({ params, stance }: { params: StanceParams; stance: StanceAdjustments }) {
  const t = useToolsT();
  const g = useMemo(() => buildFigure(params, stance), [params, stance]);

  const L = params.wheelbaseMm;
  // Visual only: a taller deck generally means bigger wheels under it.
  const wheelR = Math.min(90, Math.max(35, params.deckHeightMm - 55));
  const minX = DIM_LINE_X - DIM_GUTTER_MM;
  const maxX = L + OVERHANG_MM + 80;
  // Framed on a *stood-up* rider, not the current one: if the viewBox tracked the
  // figure, the whole board would zoom in and out as you dragged the crouch slider.
  const topZ =
    params.deckHeightMm +
    (HIP_FRACTION + TORSO_FRACTION + HEAD_GAP_FRACTION + 2 * HEAD_R_FRACTION) * params.riderHeightMm +
    90;

  return (
    <svg
      viewBox={`${minX} ${-topZ} ${maxX - minX} ${topZ + 90}`}
      className="w-full h-auto max-h-[440px]"
      role="img"
      aria-label={t("stance.diagramAria")}
    >
      {/* ground */}
      <line x1={minX} y1={0} x2={maxX} y2={0} className="text-border" stroke="currentColor" strokeWidth={6} />

      <CogDimension zMm={g.com.z} x={DIM_LINE_X} />

      <Board p={params} wheelR={wheelR} />
      <g className="text-muted-foreground" fill="currentColor" fontSize={54} textAnchor="middle">
        <text x={0} y={72}>R</text>
        <text x={L} y={72}>F</text>
      </g>

      <Feet g={g} deckZ={params.deckHeightMm} />
      <Figure g={g} />
      <ComMarker at={g.com} />
    </svg>
  );
}

export default StanceDiagram;
