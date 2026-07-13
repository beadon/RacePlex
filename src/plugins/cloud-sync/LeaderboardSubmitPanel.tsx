import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Check, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useAsyncSnapshot } from "@/hooks/useAsyncSnapshot";
import { formatLapTime } from "@/lib/lapCalculation";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import { listSnapshots } from "@/lib/lapSnapshotStorage";
import { onGarageChange } from "@/lib/garageEvents";
import { STORE_NAMES } from "@/lib/dbUtils";
import {
  contentHashForSnapshot, defaultListedWeight, isValidListedWeight,
} from "./leaderboardSubmission";
import { buildNewEntryRow, fetchMyEntries, insertEntries } from "./leaderboardClient";

/** Per-snapshot form state in the submit dialog. */
interface RowState {
  weight: string;
  unit: "lb" | "kg";
  shareEngine: boolean;
  busy: boolean;
}

interface Snapshot {
  snaps: LapSnapshot[];
  submittedHashes: Set<string>;
  loaded: boolean;
}

const EMPTY: Snapshot = { snaps: [], submittedHashes: new Set(), loaded: false };

// Profile-tab panel: submit your lap snapshots to the public leaderboards. Visible
// only when signed in (submission needs an account) and you have ≥1 snapshot.
export default function LeaderboardSubmitPanel(_props: PluginPanelProps) {
  const { t } = useTranslation("plugins");
  const { user, loading } = useAuth();
  // User-edited overrides for the per-snapshot form; falls back to the derived
  // default when a snapshot has no override yet.
  const [rowOverrides, setRowOverrides] = useState<Record<string, RowState>>({});
  const [open, setOpen] = useState(false);

  const load = useCallback(async (): Promise<Snapshot> => {
    const local = await listSnapshots();
    let submittedHashes = new Set<string>();
    if (user) {
      try {
        const mine = await fetchMyEntries(user.id);
        submittedHashes = new Set(mine.map((e) => e.contentHash));
      } catch (e) {
        // DB unique constraint is the backstop; keep the loaded snapshot list.
        console.warn("[leaderboard] couldn't load existing entries:", e);
      }
    }
    return { snaps: local, submittedHashes, loaded: true };
  }, [user]);

  const subscribe = useCallback(
    (onChange: () => void) =>
      onGarageChange((c) => {
        if (c.store === STORE_NAMES.LAP_SNAPSHOTS) onChange();
      }),
    [],
  );

  const { data: cached, refresh } = useAsyncSnapshot({
    key: `leaderboard-submit:${user?.id ?? "anon"}`,
    initial: EMPTY,
    load,
    subscribe,
  });
  const snaps = cached.snaps;
  const submittedHashes = cached.submittedHashes;

  // Per-snapshot form state: user edits win, otherwise fall back to the
  // default derived from the snapshot's own body. Deriving in useMemo means
  // no setState-in-effect churn when the snapshot list changes.
  const rows = useMemo<Record<string, RowState>>(() => {
    const next: Record<string, RowState> = {};
    for (const s of snaps) {
      const d = defaultListedWeight(s);
      next[s.id] = rowOverrides[s.id] ?? {
        weight: d.weight !== null ? String(d.weight) : "",
        unit: d.unit,
        shareEngine: false,
        busy: false,
      };
    }
    return next;
  }, [snaps, rowOverrides]);
  // Merge patches against the *derived* view so a first-edit sees the default
  // rather than `undefined`. Callers use setRows((r) => ({ ...r, [id]: ... }))
  // as before; this shim resolves the derived defaults into the override map.
  const setRows: React.Dispatch<React.SetStateAction<Record<string, RowState>>> = useCallback(
    (updater) => {
      setRowOverrides((prev) => {
        const derived: Record<string, RowState> = {};
        for (const s of snaps) {
          const d = defaultListedWeight(s);
          derived[s.id] = prev[s.id] ?? {
            weight: d.weight !== null ? String(d.weight) : "",
            unit: d.unit,
            shareEngine: false,
            busy: false,
          };
        }
        const next = typeof updater === "function" ? (updater as (r: Record<string, RowState>) => Record<string, RowState>)(derived) : updater;
        return next;
      });
    },
    [snaps],
  );

  const hashes = useMemo(() => new Map(snaps.map((s) => [s.id, contentHashForSnapshot(s)])), [snaps]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (!user) return <p className="text-xs text-muted-foreground">{t("leaderboard.signInHint")}</p>;
  if (snaps.length === 0) return <p className="text-xs text-muted-foreground">{t("leaderboard.noSnapshots")}</p>;

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const submit = async (snap: LapSnapshot) => {
    const row = rows[snap.id];
    const weight = Number(row.weight);
    if (!isValidListedWeight(weight)) {
      toast.error(t("leaderboard.weightRequired"));
      return;
    }
    setRow(snap.id, { busy: true });
    try {
      const newRow = buildNewEntryRow(snap, {
        userId: user.id,
        engineTelemetryPublic: row.shareEngine,
        listedWeight: weight,
        listedWeightUnit: row.unit,
      });
      await insertEntries([newRow]);
      // Reload from the server so `submittedHashes` reflects the just-inserted
      // row (source of truth is the DB, not local state).
      void refresh();
      toast.success(t("leaderboard.submitSuccess"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[leaderboard] submit failed:", e);
      toast.error(/duplicate key|unique/i.test(msg) ? t("leaderboard.alreadySubmitted") : t("leaderboard.submitFailed"));
    } finally {
      setRow(snap.id, { busy: false });
    }
  };

  const submittableCount = snaps.filter((s) => !submittedHashes.has(hashes.get(s.id) ?? "")).length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("leaderboard.intro", { count: snaps.length })}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" className="h-8 gap-1.5" disabled={submittableCount === 0}>
            <Trophy className="h-4 w-4" />
            {t("leaderboard.submitButton")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("leaderboard.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("leaderboard.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {snaps.map((snap) => {
              const row = rows[snap.id];
              if (!row) return null;
              const done = submittedHashes.has(hashes.get(snap.id) ?? "");
              return (
                <div key={snap.id} className="rounded-md border border-border p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {snap.engine}
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                          {formatLapTime(snap.lapTimeMs)}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {snap.trackName} — {snap.courseName}
                      </p>
                    </div>
                    {done ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5 text-green-500" />
                        {t("leaderboard.submitted")}
                      </span>
                    ) : (
                      <Button size="sm" className="h-7 text-xs" disabled={row.busy} onClick={() => void submit(snap)}>
                        {row.busy ? t("leaderboard.submitting") : t("leaderboard.submitOne")}
                      </Button>
                    )}
                  </div>

                  {!done && (
                    <>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Label htmlFor={`w-${snap.id}`} className="text-xs text-muted-foreground">
                            {t("leaderboard.listedWeight")}
                          </Label>
                          <Input
                            id={`w-${snap.id}`}
                            type="number"
                            inputMode="decimal"
                            className="h-8"
                            value={row.weight}
                            onChange={(e) => setRow(snap.id, { weight: e.target.value })}
                          />
                        </div>
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={row.unit}
                          onChange={(e) => setRow(snap.id, { unit: e.target.value as "lb" | "kg" })}
                          aria-label={t("leaderboard.listedWeight")}
                        >
                          <option value="lb">lb</option>
                          <option value="kg">kg</option>
                        </select>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("leaderboard.listedWeightHint")}</p>

                      <div className="flex items-center gap-2">
                        <Switch id={`eng-${snap.id}`} checked={row.shareEngine} onCheckedChange={(v) => setRow(snap.id, { shareEngine: v })} />
                        <Label htmlFor={`eng-${snap.id}`} className="text-xs text-muted-foreground">{t("leaderboard.shareEngineData")}</Label>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("leaderboard.publicNotice")}</p>

                      {/* Custom (non-built-in) track: its layout + sectors ride along in the
                          snapshot data AND get auto-submitted to the community track DB on
                          submit (best-effort, attributed to the signed-in user). */}
                      {snap.course?.isUserDefined && (
                        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {t("leaderboard.customTrackNotice")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
