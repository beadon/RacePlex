// Kart seat-position weight-shift visualizer.
//
// All physics lives in the pure `model.ts`; this file is rendering + state.
// Settings (kart/driver numbers, baseline, calibration) persist to the tools
// plugin's own IndexedDB store, so a calibrated setup survives reloads and
// works fully offline trackside.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { PluginPanelProps } from "@/plugins/panels";
import { getPluginStore } from "@/plugins/storage";
import { SeatDiagram } from "./SeatDiagram";
import {
  DEFAULT_PARAMS,
  KG_PER_LB,
  LB_PER_KG,
  MM_PER_INCH,
  ZERO_ADJUSTMENTS,
  computeState,
  fitKLegs,
  lateralTransferKg,
  legMassKg,
  rearMountMmFromTiltDeg,
  rebaseline,
  sensitivity,
  slideSensitivityPctPerMm,
  tiltDegFromRearMountMm,
  torsoMassKg,
  totalsFromCorners,
  type SeatAdjustments,
  type SeatModelParams,
} from "./model";

const STORE_KEY = "seat-position:v1";

type TiltMode = "deg" | "mm";

interface PersistedState {
  params: SeatModelParams;
  adj: SeatAdjustments;
  useLb: boolean;
  tiltMode: TiltMode;
}

/** ±1" slide range in 1/16" detents; ±5° tilt; ±30 mm rear-mount range. */
const SLIDE_MAX_MM = MM_PER_INCH;
const SLIDE_STEP_MM = MM_PER_INCH / 16;
const TILT_MAX_DEG = 5;
const MOUNT_MAX_MM = 30;

function formatSlideInches(mm: number): string {
  const sixteenths = Math.round((mm / MM_PER_INCH) * 16);
  if (sixteenths === 0) return '0"';
  const sign = sixteenths < 0 ? "−" : "+";
  let n = Math.abs(sixteenths);
  let d = 16;
  while (n % 2 === 0 && d > 1) {
    n /= 2;
    d /= 2;
  }
  const whole = Math.floor(n / d);
  const rem = n % d;
  const frac = rem ? `${rem}/${d}` : "";
  return `${sign}${whole ? whole + (frac ? " " : "") : ""}${frac}"`;
}

function signed(value: number, digits: number): string {
  const r = value.toFixed(digits);
  return value >= 0 ? `+${r}` : r.replace("-", "−");
}

/** Number field that doesn't fight the keyboard: commits parseable input, resyncs on outside change. */
function NumRow({ label, value, onChange, unit, step = 1, className }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  className?: string;
}) {
  const display = useMemo(() => String(Number(value.toFixed(2))), [value]);
  const [text, setText] = useState(display);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(display);
  }, [display]);
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {unit ? ` (${unit})` : ""}
      </Label>
      <NumberInput
        className="h-8 mt-1 text-sm"
        step={step}
        value={text}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          setText(display);
        }}
        onValueChange={(raw) => {
          setText(raw);
          const v = parseFloat(raw);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground">
        {title}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border p-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export default function SeatPositionTool(_props: PluginPanelProps) {
  const store = useMemo(() => getPluginStore("tools"), []);
  const [params, setParams] = useState<SeatModelParams>(DEFAULT_PARAMS);
  const [adj, setAdj] = useState<SeatAdjustments>(ZERO_ADJUSTMENTS);
  const [useLb, setUseLb] = useState(true);
  const [tiltMode, setTiltMode] = useState<TiltMode>("deg");
  const [loaded, setLoaded] = useState(false);

  // Calibration scratchpad (kg internally, displayed in the chosen unit).
  const [cal, setCal] = useState({ fl: 0, fr: 0, rl: 0, rr: 0, slideMm: 20, movedFrontKg: 0 });

  useEffect(() => {
    let active = true;
    store
      .get<PersistedState>(STORE_KEY)
      .then((saved) => {
        if (active && saved) {
          setParams({ ...DEFAULT_PARAMS, ...saved.params });
          setAdj({ ...ZERO_ADJUSTMENTS, ...saved.adj });
          setUseLb(saved.useLb ?? true);
          setTiltMode(saved.tiltMode ?? "deg");
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
    const t = setTimeout(() => {
      void store.set(STORE_KEY, { params, adj, useLb, tiltMode } satisfies PersistedState).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [params, adj, useLb, tiltMode, loaded, store]);

  const state = useMemo(() => computeState(params, adj), [params, adj]);
  const zeroState = useMemo(() => computeState(params, ZERO_ADJUSTMENTS), [params]);
  const sens = useMemo(() => sensitivity(params, adj), [params, adj]);
  const naivePctPerInch = useMemo(
    () => slideSensitivityPctPerMm({ ...params, kLegs: 1 }) * MM_PER_INCH,
    [params],
  );

  const deltaRearPct = state.loads.rearPct - zeroState.loads.rearPct;
  const deltaCogZ = state.com.zMm - zeroState.com.zMm;
  const atZero = adj.slideMm === 0 && adj.tiltDeg === 0;
  const latTransfer = lateralTransferKg(state.com, params.trackWidthMm, 1.5);
  const latTransferDelta = latTransfer - lateralTransferKg(zeroState.com, params.trackWidthMm, 1.5);

  const fmtW = (kg: number) =>
    useLb ? `${(kg * LB_PER_KG).toFixed(1)} lb (${kg.toFixed(1)} kg)` : `${kg.toFixed(1)} kg (${(kg * LB_PER_KG).toFixed(1)} lb)`;
  const fmtWShort = (kg: number) => (useLb ? `${(kg * LB_PER_KG).toFixed(1)} lb` : `${kg.toFixed(1)} kg`);
  const toUnit = (kg: number) => (useLb ? kg * LB_PER_KG : kg);
  const fromUnit = (v: number) => (useLb ? v * KG_PER_LB : v);
  const wUnit = useLb ? "lb" : "kg";

  const cornerTotals = totalsFromCorners({ fl: cal.fl, fr: cal.fr, rl: cal.rl, rr: cal.rr });
  const canApplyBaseline = cornerTotals.totalKg > params.driverMassKg + params.fuelKg + params.seatMassKg;
  const canFitKLegs = cornerTotals.frontKg > 0 && cal.movedFrontKg > 0 && cal.slideMm !== 0;

  const setParam = <K extends keyof SeatModelParams>(key: K, value: SeatModelParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }));

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Diagram + adjustment sliders */}
          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-border bg-card p-3">
              <SeatDiagram params={params} adjustments={adj} />
              <p className="mt-1 text-[11px] text-muted-foreground text-center">
                Gray ghost = zero point · crosshair = combined CoG · dot = tilt anchor
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-5">
              <div>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">Seat slide (fore/aft)</Label>
                  <span className="text-sm font-medium tabular-nums">
                    {formatSlideInches(adj.slideMm)} <span className="text-muted-foreground">({signed(adj.slideMm, 1)} mm)</span>
                  </span>
                </div>
                <Slider
                  className="mt-2"
                  min={-SLIDE_MAX_MM}
                  max={SLIDE_MAX_MM}
                  step={SLIDE_STEP_MM}
                  value={[adj.slideMm]}
                  onValueChange={([v]) => setAdj((a) => ({ ...a, slideMm: v }))}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>−1" (rear)</span>
                  <span>+1" (front)</span>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Seat tilt</Label>
                    <button
                      onClick={() => setTiltMode((m) => (m === "deg" ? "mm" : "deg"))}
                      className="text-[10px] text-primary underline-offset-2 hover:underline"
                    >
                      {tiltMode === "deg" ? "use rear-mount mm" : "use degrees"}
                    </button>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {signed(adj.tiltDeg, 2)}°{" "}
                    <span className="text-muted-foreground">
                      (mount {signed(rearMountMmFromTiltDeg(adj.tiltDeg, params.rearMountArmMm), 1)} mm)
                    </span>
                  </span>
                </div>
                {tiltMode === "deg" ? (
                  <Slider
                    className="mt-2"
                    min={-TILT_MAX_DEG}
                    max={TILT_MAX_DEG}
                    step={0.25}
                    value={[adj.tiltDeg]}
                    onValueChange={([v]) => setAdj((a) => ({ ...a, tiltDeg: v }))}
                  />
                ) : (
                  <Slider
                    className="mt-2"
                    min={-MOUNT_MAX_MM}
                    max={MOUNT_MAX_MM}
                    step={1}
                    value={[Math.round(rearMountMmFromTiltDeg(adj.tiltDeg, params.rearMountArmMm))]}
                    onValueChange={([v]) => setAdj((a) => ({ ...a, tiltDeg: tiltDegFromRearMountMm(v, params.rearMountArmMm) }))}
                  />
                )}
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{tiltMode === "deg" ? "−5° (upright)" : "−30 mm (raise mount)"}</span>
                  <span>{tiltMode === "deg" ? "+5° (recline)" : "+30 mm (lower mount)"}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={atZero} onClick={() => setAdj(ZERO_ADJUSTMENTS)}>
                  <RotateCcw className="w-3.5 h-3.5" /> Reset sliders
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={atZero}
                  onClick={() => {
                    setParams((p) => rebaseline(p, adj));
                    setAdj(ZERO_ADJUSTMENTS);
                  }}
                >
                  <Crosshair className="w-3.5 h-3.5" /> Set current as zero
                </Button>
              </div>
            </div>
          </div>

          {/* Readouts */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Weight shift vs zero</p>
              <p
                className={`mt-1 text-3xl font-bold tabular-nums ${
                  deltaRearPct > 0.005 ? "text-warning" : deltaRearPct < -0.005 ? "text-primary" : "text-foreground"
                }`}
              >
                {signed(deltaRearPct, 2)}% rear
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {deltaRearPct > 0.005 ? "rear bias added" : deltaRearPct < -0.005 ? "forward bias added" : "at the zero point"}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex h-3 overflow-hidden rounded">
                <div className="bg-primary/70" style={{ width: `${state.loads.frontPct}%` }} />
                <div className="flex-1 bg-warning/70" />
              </div>
              <div className="flex justify-between text-xs">
                <div>
                  <p className="font-medium text-foreground">Front {state.loads.frontPct.toFixed(1)}%</p>
                  <p className="text-muted-foreground">{fmtW(state.loads.frontKg)}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-foreground">Rear {state.loads.rearPct.toFixed(1)}%</p>
                  <p className="text-muted-foreground">{fmtW(state.loads.rearKg)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1.5">
              <p className="font-medium text-foreground">Centre of gravity</p>
              <p className="text-muted-foreground tabular-nums">
                {state.com.xMm.toFixed(0)} mm fwd of rear axle · {state.com.zMm.toFixed(0)} mm high
              </p>
              <p className="tabular-nums">
                <span className="text-muted-foreground">Δ height: </span>
                <span className={deltaCogZ < -0.05 ? "text-primary font-medium" : deltaCogZ > 0.05 ? "text-warning font-medium" : "text-foreground"}>
                  {signed(deltaCogZ, 1)} mm
                </span>
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1.5">
              <p className="font-medium text-foreground">Sensitivity (here)</p>
              <p className="text-muted-foreground tabular-nums">{signed(sens.pctPerInch, 2)}% front per inch of slide</p>
              <p className="text-muted-foreground tabular-nums">{signed(sens.pctPerDeg, 2)}% front per degree of recline</p>
              <p className="text-[10px] text-muted-foreground/70">
                Naive "whole driver moves" estimate: {signed(naivePctPerInch, 2)}%/in — feet-on-pedals model is the lower number.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1.5">
              <p className="font-medium text-foreground">Cornering transfer @ 1.5 g</p>
              <p className="text-muted-foreground tabular-nums">
                {fmtWShort(latTransfer)} across the kart{" "}
                <span className={latTransferDelta < -0.005 ? "text-primary" : latTransferDelta > 0.005 ? "text-warning" : ""}>
                  ({signed(toUnit(latTransferDelta), 1)} {wUnit} vs zero)
                </span>
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                Rigid-frame approximation — karts corner on frame jacking, so treat as a relative indicator.
              </p>
            </div>
          </div>
        </div>

        <Section title="Kart & driver" defaultOpen>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-3 flex items-center gap-2">
              <Label htmlFor="seat-tool-units" className="text-xs text-muted-foreground">kg</Label>
              <Switch id="seat-tool-units" checked={useLb} onCheckedChange={setUseLb} />
              <Label htmlFor="seat-tool-units" className="text-xs text-muted-foreground">lb</Label>
            </div>
            <NumRow label="Driver (with gear)" unit={wUnit} value={toUnit(params.driverMassKg)} onChange={(v) => setParam("driverMassKg", Math.max(fromUnit(v), 1))} />
            <NumRow label="Kart (no driver/fuel)" unit={wUnit} value={toUnit(params.kartMassKg)} onChange={(v) => setParam("kartMassKg", Math.max(fromUnit(v), params.seatMassKg + 1))} />
            <NumRow label="Fuel" unit={wUnit} value={toUnit(params.fuelKg)} onChange={(v) => setParam("fuelKg", Math.max(fromUnit(v), 0))} step={useLb ? 1 : 0.5} />
            <NumRow label="Wheelbase" unit="mm" value={params.wheelbaseMm} onChange={(v) => setParam("wheelbaseMm", Math.max(v, 500))} step={5} />
            <NumRow label="Baseline front weight" unit="%" value={params.baselineFrontPct} onChange={(v) => setParam("baselineFrontPct", Math.min(Math.max(v, 20), 70))} step={0.5} />
            <NumRow label="Baseline CoG height" unit="mm" value={params.baselineCogZMm} onChange={(v) => setParam("baselineCogZMm", Math.max(v, 50))} step={5} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            The baseline is your kart at the zero point — most sprint setups target 43% front (some run 40). Corner scales beat guesses: see Calibration.
          </p>
        </Section>

        <Section title="Advanced model">
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <Label className="text-xs">Leg coupling k<sub>legs</sub></Label>
                <span className="text-sm font-medium tabular-nums">{params.kLegs.toFixed(2)}</span>
              </div>
              <Slider className="mt-2" min={0} max={1} step={0.05} value={[params.kLegs]} onValueChange={([v]) => setParam("kLegs", v)} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                How much of the seat's movement the leg CoM follows (feet stay on the pedals). 0.4 is a sane default — calibrate it on scales.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <NumRow label="Torso fraction of driver" unit="0–1" value={params.torsoFraction} onChange={(v) => setParam("torsoFraction", Math.min(Math.max(v, 0.4), 0.9))} step={0.01} />
              <NumRow label="Seat mass" unit={wUnit} value={toUnit(params.seatMassKg)} onChange={(v) => setParam("seatMassKg", Math.min(Math.max(fromUnit(v), 0.5), params.kartMassKg - 1))} step={useLb ? 1 : 0.5} />
              <NumRow label="Anchor fwd of rear axle" unit="mm" value={params.anchorXMm} onChange={(v) => setParam("anchorXMm", v)} step={5} />
              <NumRow label="Anchor height" unit="mm" value={params.anchorZMm} onChange={(v) => setParam("anchorZMm", v)} step={5} />
              <NumRow label="Torso CoM distance" unit="mm" value={params.torsoRMm} onChange={(v) => setParam("torsoRMm", Math.max(v, 100))} step={10} />
              <NumRow label="Torso CoM angle" unit="° from fwd" value={params.torsoAlphaDeg} onChange={(v) => setParam("torsoAlphaDeg", v)} />
              <NumRow label="Anchor → rear mount" unit="mm" value={params.rearMountArmMm} onChange={(v) => setParam("rearMountArmMm", Math.max(v, 50))} step={10} />
              <NumRow label="Rear track width" unit="mm" value={params.trackWidthMm} onChange={(v) => setParam("trackWidthMm", Math.max(v, 600))} step={10} />
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setParams(DEFAULT_PARAMS)}>
              Restore defaults
            </Button>
          </div>
        </Section>

        <Section title="Calibration (corner scales)">
          <div className="space-y-4 text-xs">
            <p className="text-muted-foreground">
              Default numbers are ±20% per driver. Two scale sessions anchor the model to <em>your</em> kart: weigh at the zero point, then slide the seat a
              known amount and re-weigh to fit the leg coupling.
            </p>
            <div>
              <p className="font-medium text-foreground mb-2">1 · Corner weights at the zero point (driver seated)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <NumRow label="Front left" unit={wUnit} value={toUnit(cal.fl)} onChange={(v) => setCal((c) => ({ ...c, fl: Math.max(fromUnit(v), 0) }))} />
                <NumRow label="Front right" unit={wUnit} value={toUnit(cal.fr)} onChange={(v) => setCal((c) => ({ ...c, fr: Math.max(fromUnit(v), 0) }))} />
                <NumRow label="Rear left" unit={wUnit} value={toUnit(cal.rl)} onChange={(v) => setCal((c) => ({ ...c, rl: Math.max(fromUnit(v), 0) }))} />
                <NumRow label="Rear right" unit={wUnit} value={toUnit(cal.rr)} onChange={(v) => setCal((c) => ({ ...c, rr: Math.max(fromUnit(v), 0) }))} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!canApplyBaseline}
                  onClick={() =>
                    setParams((p) => ({
                      ...p,
                      kartMassKg: Math.max(cornerTotals.totalKg - p.driverMassKg - p.fuelKg, p.seatMassKg + 1),
                      baselineFrontPct: cornerTotals.frontPct,
                    }))
                  }
                >
                  Apply baseline
                </Button>
                {cornerTotals.totalKg > 0 && (
                  <span className="text-muted-foreground tabular-nums">
                    Total {fmtWShort(cornerTotals.totalKg)} · front {cornerTotals.frontPct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="font-medium text-foreground mb-2">2 · Slide the seat a known amount and re-weigh the front pair</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <NumRow label="Seat slid by (+fwd)" unit="mm" value={cal.slideMm} onChange={(v) => setCal((c) => ({ ...c, slideMm: v }))} step={5} />
                <NumRow label="New front-axle total" unit={wUnit} value={toUnit(cal.movedFrontKg)} onChange={(v) => setCal((c) => ({ ...c, movedFrontKg: Math.max(fromUnit(v), 0) }))} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!canFitKLegs}
                  onClick={() =>
                    setParam(
                      "kLegs",
                      Math.round(
                        fitKLegs({
                          baselineFrontKg: cornerTotals.frontKg,
                          movedFrontKg: cal.movedFrontKg,
                          slideMm: cal.slideMm,
                          wheelbaseMm: params.wheelbaseMm,
                          torsoMassKg: torsoMassKg(params),
                          seatMassKg: params.seatMassKg,
                          legMassKg: legMassKg(params),
                        }) * 100,
                      ) / 100,
                    )
                  }
                >
                  Fit leg coupling
                </Button>
                <span className="text-muted-foreground tabular-nums">current k = {params.kLegs.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
