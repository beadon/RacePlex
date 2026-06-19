import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Gauge, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ModeToggle } from "@/components/drawer/ModeToggle";
import { PostSessionData, TirePsiMode } from "@/lib/fileStorage";

interface PostSessionPanelProps {
  /** The session's saved post-session data (null until first save). */
  postSession: PostSessionData | null;
  onSave: (data: PostSessionData) => Promise<void>;
}

const PSI_OPTIONS = ["single", "halves", "quarters"] as const;

/** Detect the editor mode from stored corner pressures (defaults to quarters). */
function detectMode(d: PostSessionData | null): TirePsiMode {
  if (d?.tirePsiMode) return d.tirePsiMode;
  return "quarters";
}

const numOrNull = (v: string): number | null => (v === "" ? null : parseFloat(v));

/**
 * Collapsible post-session capture under the Notes session-setup panel: tire
 * pressures (single / halves / quarters, default quarters) + a single weight.
 * Saved to FileMetadata so it cloud-syncs with the session. Held for later
 * processing — nothing consumes it yet.
 */
export function PostSessionPanel({ postSession, onSave }: PostSessionPanelProps) {
  const { t } = useTranslation("drawer");
  const [open, setOpen] = useState(false);

  const [mode, setMode] = useState<TirePsiMode>("quarters");
  const [psiSingle, setPsiSingle] = useState<number | null>(null);
  const [psiFront, setPsiFront] = useState<number | null>(null);
  const [psiRear, setPsiRear] = useState<number | null>(null);
  const [fl, setFl] = useState<number | null>(null);
  const [fr, setFr] = useState<number | null>(null);
  const [rl, setRl] = useState<number | null>(null);
  const [rr, setRr] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);

  // Reload local state whenever a different session's data arrives.
  useEffect(() => {
    const m = detectMode(postSession);
    setMode(m);
    setFl(postSession?.tirePsiFrontLeft ?? null);
    setFr(postSession?.tirePsiFrontRight ?? null);
    setRl(postSession?.tirePsiRearLeft ?? null);
    setRr(postSession?.tirePsiRearRight ?? null);
    setPsiSingle(m === "single" ? postSession?.tirePsiFrontLeft ?? null : null);
    setPsiFront(m === "halves" ? postSession?.tirePsiFrontLeft ?? null : null);
    setPsiRear(m === "halves" ? postSession?.tirePsiRearLeft ?? null : null);
    setWeight(postSession?.weight ?? null);
  }, [postSession]);

  // Project the current editor state into the canonical 4-corner + weight shape.
  const draft = useMemo<PostSessionData>(() => {
    let corners: Pick<PostSessionData, "tirePsiFrontLeft" | "tirePsiFrontRight" | "tirePsiRearLeft" | "tirePsiRearRight">;
    if (mode === "single") {
      corners = { tirePsiFrontLeft: psiSingle, tirePsiFrontRight: psiSingle, tirePsiRearLeft: psiSingle, tirePsiRearRight: psiSingle };
    } else if (mode === "halves") {
      corners = { tirePsiFrontLeft: psiFront, tirePsiFrontRight: psiFront, tirePsiRearLeft: psiRear, tirePsiRearRight: psiRear };
    } else {
      corners = { tirePsiFrontLeft: fl, tirePsiFrontRight: fr, tirePsiRearLeft: rl, tirePsiRearRight: rr };
    }
    return { tirePsiMode: mode, ...corners, weight };
  }, [mode, psiSingle, psiFront, psiRear, fl, fr, rl, rr, weight]);

  const saved = useMemo<PostSessionData>(() => ({
    tirePsiMode: detectMode(postSession),
    tirePsiFrontLeft: postSession?.tirePsiFrontLeft ?? null,
    tirePsiFrontRight: postSession?.tirePsiFrontRight ?? null,
    tirePsiRearLeft: postSession?.tirePsiRearLeft ?? null,
    tirePsiRearRight: postSession?.tirePsiRearRight ?? null,
    weight: postSession?.weight ?? null,
  }), [postSession]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const hasData = postSession != null;

  const handleSave = useCallback(async () => {
    await onSave(draft);
  }, [onSave, draft]);

  return (
    <div className="border-b border-border shrink-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex-1 text-left">
            {t("postSession.title")}
          </span>
          {hasData && <Check className="w-3 h-3 text-primary shrink-0" />}
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {/* Tire Pressure */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("postSession.tirePressure")}</Label>
              <ModeToggle
                options={PSI_OPTIONS}
                labels={[t("setups.single"), t("setups.halves"), t("setups.quarters")]}
                value={mode}
                onChange={setMode}
              />
              {mode === "single" && (
                <Field label={t("setups.allTires")}>
                  <NumberInput step="0.01" className="h-9" value={psiSingle ?? ""} onChange={e => setPsiSingle(numOrNull(e.target.value))} />
                </Field>
              )}
              {mode === "halves" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.front")}><NumberInput step="0.01" className="h-9" value={psiFront ?? ""} onChange={e => setPsiFront(numOrNull(e.target.value))} /></Field>
                  <Field label={t("setups.rear")}><NumberInput step="0.01" className="h-9" value={psiRear ?? ""} onChange={e => setPsiRear(numOrNull(e.target.value))} /></Field>
                </div>
              )}
              {mode === "quarters" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("setups.fl")}><NumberInput step="0.01" className="h-9" value={fl ?? ""} onChange={e => setFl(numOrNull(e.target.value))} /></Field>
                  <Field label={t("setups.fr")}><NumberInput step="0.01" className="h-9" value={fr ?? ""} onChange={e => setFr(numOrNull(e.target.value))} /></Field>
                  <Field label={t("setups.rl")}><NumberInput step="0.01" className="h-9" value={rl ?? ""} onChange={e => setRl(numOrNull(e.target.value))} /></Field>
                  <Field label={t("setups.rr")}><NumberInput step="0.01" className="h-9" value={rr ?? ""} onChange={e => setRr(numOrNull(e.target.value))} /></Field>
                </div>
              )}
            </div>

            {/* Weight */}
            <Field label={t("postSession.weight")}>
              <NumberInput step="0.01" className="h-9" value={weight ?? ""} onChange={e => setWeight(numOrNull(e.target.value))} placeholder={t("postSession.weightPlaceholder")} />
            </Field>

            <Button className="w-full" size="sm" onClick={handleSave} disabled={!isDirty}>
              {hasData ? t("postSession.update") : t("postSession.save")}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
