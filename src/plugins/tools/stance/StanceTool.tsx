// eSkate stance (foot position) visualizer.
//
// All physics lives in the pure `model.ts`; this file is rendering + state.
// Board/rider numbers persist to the tools plugin's own IndexedDB store, so a
// rider's board survives reloads and works offline.
//
// The headline readout is the ENDO threshold, not the front/rear split: on a
// board the split is a means, and going over the nose under braking is the end.

import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { PluginPanelProps } from "@/plugins/panels";
import { getPluginStore } from "@/plugins/storage";
import { StanceDiagram } from "./StanceDiagram";
import { NumRow, Section } from "../ToolControls";
import { signed } from "../format";
import { useToolsT } from "../i18n";
import {
  DEFAULT_PARAMS,
  DEFAULT_STANCE,
  KART_TYPICAL_COG_MM,
  KG_PER_LB,
  LB_PER_KG,
  TYPICAL_GRIP_G,
  axleLoadsAtAccel,
  brakingLimit,
  computeState,
  leanAngleDeg,
  loadTransferKg,
  riderMassFractionPct,
  type StanceAdjustments,
  type StanceParams,
} from "./model";

const STORE_KEY = "stance:v1";

/** Minimum stance the sliders will let you set, mm — feet can't overlap. */
const MIN_STANCE_MM = 120;
/** How far past a truck a foot may sit (over the nose/tail), mm. */
const FOOT_OVERHANG_MM = 80;
/** The braking level the "what actually happens" panel is evaluated at, g. */
const DEFAULT_BRAKE_G = 0.3;
/** Lateral load the lean-angle note is quoted at, g. */
const LAT_G = 0.5;

interface PersistedState {
  params: StanceParams;
  stance: StanceAdjustments;
  useLb: boolean;
  brakeG: number;
}

export default function StanceTool(_props: PluginPanelProps) {
  const t = useToolsT();
  const store = useMemo(() => getPluginStore("tools"), []);
  const [params, setParams] = useState<StanceParams>(DEFAULT_PARAMS);
  const [stance, setStance] = useState<StanceAdjustments>(DEFAULT_STANCE);
  const [useLb, setUseLb] = useState(true);
  const [brakeG, setBrakeG] = useState(DEFAULT_BRAKE_G);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    store
      .get<PersistedState>(STORE_KEY)
      .then((saved) => {
        if (active && saved) {
          setParams({ ...DEFAULT_PARAMS, ...saved.params });
          setStance({ ...DEFAULT_STANCE, ...saved.stance });
          setUseLb(saved.useLb ?? true);
          setBrakeG(saved.brakeG ?? DEFAULT_BRAKE_G);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [store]);

  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      void store.set(STORE_KEY, { params, stance, useLb, brakeG } satisfies PersistedState).catch(() => undefined);
    }, 400);
    return () => clearTimeout(id);
  }, [params, stance, useLb, brakeG, loaded, store]);

  const state = useMemo(() => computeState(params, stance), [params, stance]);
  const neutral = useMemo(() => computeState(params, { ...stance, crouchPct: 0 }), [params, stance]);

  const { endoG, wheelieG } = state.thresholds;
  const braking = axleLoadsAtAccel(state.com, params.wheelbaseMm, -brakeG);
  const transferKg = loadTransferKg(state.com, params.wheelbaseMm, brakeG);
  const rearLifted = braking.rearKg <= 0;
  const limit = brakingLimit(endoG);
  const crouchGain = endoG - neutral.thresholds.endoG;

  const fmtW = (kg: number) => (useLb ? `${(kg * LB_PER_KG).toFixed(1)} lb` : `${kg.toFixed(1)} kg`);
  const toUnit = (kg: number) => (useLb ? kg * LB_PER_KG : kg);
  const fromUnit = (v: number) => (useLb ? v * KG_PER_LB : v);
  const wUnit = useLb ? "lb" : "kg";

  const setParam = <K extends keyof StanceParams>(key: K, value: StanceParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  // Feet may hang over the trucks, but never cross (or the model's "front" foot
  // would be behind the rear one and every readout would read backwards).
  const footMin = -FOOT_OVERHANG_MM;
  const footMax = params.wheelbaseMm + FOOT_OVERHANG_MM;
  const setFrontFoot = (v: number) =>
    setStance((s) => ({ ...s, frontFootXMm: Math.max(v, s.rearFootXMm + MIN_STANCE_MM) }));
  const setRearFoot = (v: number) =>
    setStance((s) => ({ ...s, rearFootXMm: Math.min(v, s.frontFootXMm - MIN_STANCE_MM) }));

  const atDefaultStance =
    stance.frontFootXMm === DEFAULT_STANCE.frontFootXMm &&
    stance.rearFootXMm === DEFAULT_STANCE.rearFootXMm &&
    stance.weightSplitPct === DEFAULT_STANCE.weightSplitPct &&
    stance.crouchPct === DEFAULT_STANCE.crouchPct;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Diagram + stance sliders */}
          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-border bg-card p-3">
              <StanceDiagram params={params} stance={stance} />
              <p className="mt-1 text-[11px] text-muted-foreground text-center">{t("stance.diagramLegend")}</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-5">
              <div>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">{t("stance.rearFootLabel")}</Label>
                  <span className="text-sm font-medium tabular-nums">{stance.rearFootXMm.toFixed(0)} mm</span>
                </div>
                <Slider
                  className="mt-2"
                  min={footMin}
                  max={footMax}
                  step={5}
                  value={[stance.rearFootXMm]}
                  onValueChange={([v]) => setRearFoot(v)}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{t("stance.overTail")}</span>
                  <span>{t("stance.towardNose")}</span>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">{t("stance.frontFootLabel")}</Label>
                  <span className="text-sm font-medium tabular-nums">{stance.frontFootXMm.toFixed(0)} mm</span>
                </div>
                <Slider
                  className="mt-2"
                  min={footMin}
                  max={footMax}
                  step={5}
                  value={[stance.frontFootXMm]}
                  onValueChange={([v]) => setFrontFoot(v)}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{t("stance.towardTail")}</span>
                  <span>{t("stance.overNose")}</span>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">{t("stance.splitLabel")}</Label>
                  <span className="text-sm font-medium tabular-nums">
                    {t("stance.splitValue", {
                      front: stance.weightSplitPct.toFixed(0),
                      rear: (100 - stance.weightSplitPct).toFixed(0),
                    })}
                  </span>
                </div>
                <Slider
                  className="mt-2"
                  min={0}
                  max={100}
                  step={5}
                  value={[stance.weightSplitPct]}
                  onValueChange={([v]) => setStance((s) => ({ ...s, weightSplitPct: v }))}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{t("stance.allRearFoot")}</span>
                  <span>{t("stance.allFrontFoot")}</span>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">{t("stance.crouchLabel")}</Label>
                  <span className="text-sm font-medium tabular-nums">
                    {stance.crouchPct.toFixed(0)}%
                    {crouchGain > 0.005 && (
                      <span className="text-primary"> ({t("stance.crouchGain", { value: signed(crouchGain, 2) })})</span>
                    )}
                  </span>
                </div>
                <Slider
                  className="mt-2"
                  min={0}
                  max={100}
                  step={5}
                  value={[stance.crouchPct]}
                  onValueChange={([v]) => setStance((s) => ({ ...s, crouchPct: v }))}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{t("stance.standingTall")}</span>
                  <span>{t("stance.deepTuck")}</span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={atDefaultStance}
                onClick={() => setStance(DEFAULT_STANCE)}
              >
                <RotateCcw className="w-3.5 h-3.5" /> {t("stance.resetStance")}
              </Button>
            </div>
          </div>

          {/* Readouts */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("stance.endoTitle")}</p>
              <p
                className={`mt-1 text-3xl font-bold tabular-nums ${
                  endoG < 0.35 ? "text-destructive" : endoG < 0.5 ? "text-warning" : "text-primary"
                }`}
              >
                {t("stance.gValue", { value: endoG.toFixed(2) })}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {limit === "endo" ? t("stance.endoBelowGrip", { grip: TYPICAL_GRIP_G.toFixed(1) }) : t("stance.gripFirst")}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex h-3 overflow-hidden rounded">
                <div className="bg-primary/70" style={{ width: `${Math.min(Math.max(state.loads.frontPct, 0), 100)}%` }} />
                <div className="flex-1 bg-warning/70" />
              </div>
              <div className="flex justify-between text-xs">
                <div>
                  <p className="font-medium text-foreground">{t("stance.front", { pct: state.loads.frontPct.toFixed(1) })}</p>
                  <p className="text-muted-foreground">{fmtW(state.loads.frontKg)}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-foreground">{t("stance.rear", { pct: state.loads.rearPct.toFixed(1) })}</p>
                  <p className="text-muted-foreground">{fmtW(state.loads.rearKg)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1.5">
              <p className="font-medium text-foreground">{t("stance.cogTitle")}</p>
              <p className="text-muted-foreground tabular-nums">
                {t("stance.cogPosition", { x: state.com.xMm.toFixed(0), z: state.com.zMm.toFixed(0) })}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {t("stance.cogVsKart", {
                  ratio: (state.com.zMm / KART_TYPICAL_COG_MM).toFixed(1),
                  kart: KART_TYPICAL_COG_MM,
                })}
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {t("stance.riderShare", { pct: riderMassFractionPct(params).toFixed(0) })}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="font-medium text-foreground">{t("stance.brakingTitle")}</p>
                <span className="tabular-nums text-muted-foreground">{brakeG.toFixed(2)} g</span>
              </div>
              <Slider min={0.05} max={0.8} step={0.05} value={[brakeG]} onValueChange={([v]) => setBrakeG(v)} />
              <p className="text-muted-foreground tabular-nums">
                {t("stance.transfer", { weight: fmtW(transferKg) })}
              </p>
              <p className={`tabular-nums ${rearLifted ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {rearLifted
                  ? t("stance.rearLifted")
                  : t("stance.rearRemaining", {
                      weight: fmtW(braking.rearKg),
                      pct: braking.rearPct.toFixed(0),
                    })}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1.5">
              <p className="font-medium text-foreground">{t("stance.wheelieTitle")}</p>
              <p className="text-muted-foreground tabular-nums">{t("stance.wheelieValue", { value: wheelieG.toFixed(2) })}</p>
              <p className="text-[10px] text-muted-foreground/70">{t("stance.wheelieNote")}</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1.5">
              <p className="font-medium text-foreground">{t("stance.lateralTitle")}</p>
              <p className="text-muted-foreground tabular-nums">
                {t("stance.leanAngle", { deg: leanAngleDeg(LAT_G).toFixed(0), lat: LAT_G.toFixed(1) })}
              </p>
              <p className="text-[10px] text-muted-foreground/70">{t("stance.lateralNote")}</p>
            </div>
          </div>
        </div>

        <Section title={t("stance.sectionBoardRider")} defaultOpen>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-3 flex items-center gap-2">
              <Label htmlFor="stance-tool-units" className="text-xs text-muted-foreground">kg</Label>
              <Switch id="stance-tool-units" checked={useLb} onCheckedChange={setUseLb} />
              <Label htmlFor="stance-tool-units" className="text-xs text-muted-foreground">lb</Label>
            </div>
            <NumRow
              label={t("stance.riderMass")}
              unit={wUnit}
              value={toUnit(params.riderMassKg)}
              onChange={(v) => setParam("riderMassKg", Math.min(Math.max(fromUnit(v), 25), 200))}
            />
            <NumRow
              label={t("stance.riderHeight")}
              unit="mm"
              value={params.riderHeightMm}
              onChange={(v) => setParam("riderHeightMm", Math.min(Math.max(v, 1200), 2200))}
              step={10}
            />
            <NumRow
              label={t("stance.boardMass")}
              unit={wUnit}
              value={toUnit(params.boardMassKg)}
              onChange={(v) => setParam("boardMassKg", Math.min(Math.max(fromUnit(v), 3), 40))}
              step={useLb ? 1 : 0.5}
            />
            <NumRow
              label={t("stance.wheelbase")}
              unit="mm"
              value={params.wheelbaseMm}
              onChange={(v) => {
                const L = Math.min(Math.max(v, 400), 1100);
                setParam("wheelbaseMm", L);
                // Keep the feet on the board when the wheelbase shrinks under them.
                setStance((s) => ({
                  ...s,
                  frontFootXMm: Math.min(s.frontFootXMm, L + FOOT_OVERHANG_MM),
                  rearFootXMm: Math.max(s.rearFootXMm, -FOOT_OVERHANG_MM),
                }));
              }}
              step={5}
            />
            <NumRow
              label={t("stance.deckHeight")}
              unit="mm"
              value={params.deckHeightMm}
              onChange={(v) => setParam("deckHeightMm", Math.min(Math.max(v, 50), 200))}
              step={5}
            />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">{t("stance.boardRiderNote")}</p>
          <Button variant="outline" size="sm" className="h-8 mt-3" onClick={() => setParams(DEFAULT_PARAMS)}>
            {t("stance.restoreDefaults")}
          </Button>
        </Section>

        <Section title={t("stance.sectionModel")}>
          <div className="text-xs text-muted-foreground space-y-2">
            <p>{t("stance.modelCoM")}</p>
            <p>{t("stance.modelEndo")}</p>
            <p>{t("stance.modelWheelie")}</p>
            <p className="text-muted-foreground/70">{t("stance.modelCaveat")}</p>
          </div>
        </Section>
      </div>
    </div>
  );
}
