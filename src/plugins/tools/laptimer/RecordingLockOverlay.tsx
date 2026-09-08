/**
 * Full-screen "recording — locked" overlay (issue: phone-GPS sessions losing
 * most of a ride when the tab backgrounds — see plan 0025). A wake lock
 * already keeps the screen from auto-sleeping, but it can't stop an
 * accidental tap while the phone rides loose in a pocket with the screen
 * lit, and it can't talk anyone out of pressing the power button before
 * pocketing it (that's outside what a web page can override, by design).
 * This overlay covers the first problem directly and the second with a
 * plain warning: it blocks every tap except a deliberate press-and-hold on
 * the unlock ring, the same reasoning workout/navigation apps use a locked
 * screen for.
 */
import { Heart, Lock, LockOpen } from "lucide-react";
import { useHoldToConfirm } from "@/hooks/useHoldToConfirm";
import { SidecarDataChips } from "@/components/SidecarDataChips";
import { useToolsT } from "../i18n";

const HOLD_DURATION_MS = 1500;
const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function RecordingLockOverlay({
  speed,
  speedUnit,
  onUnlock,
  durationLabel,
  heartRateBpm,
  hasVescData,
  hasBmsData,
}: {
  speed: number;
  speedUnit: string;
  onUnlock: () => void;
  /** Elapsed recording duration, already formatted ("M:SS"/"H:MM:SS") — a locked
   *  screen shouldn't need to do its own clock math. */
  durationLabel?: string;
  /** Live BPM from a connected heart-rate sidecar (issue #87), when present. */
  heartRateBpm?: number | null;
  /** A VESC/BMS sidecar is currently connected and reporting (issues #58, #73)
   *  — so a rider can see at a glance that everything is still recording
   *  without unlocking the screen. */
  hasVescData?: boolean;
  hasBmsData?: boolean;
}) {
  const t = useToolsT();
  const { progress, handlers } = useHoldToConfirm(HOLD_DURATION_MS, onUnlock);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-background p-6 text-center"
      // Swallow taps anywhere on the overlay — only the unlock ring itself
      // (via its own pointer handlers) does anything.
      onPointerDown={(e) => e.preventDefault()}
    >
      <div>
        <div className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> {t("laptimer.lockedStatus")}
        </div>
        <div className="mt-2 font-mono text-7xl font-bold leading-none tabular-nums text-foreground">
          {speed.toFixed(0)}
          <span className="ml-2 text-xl font-normal text-muted-foreground">{speedUnit}</span>
        </div>
        {durationLabel && (
          <div className="mt-1 font-mono text-lg tabular-nums text-muted-foreground">{durationLabel}</div>
        )}
        {(heartRateBpm != null || hasVescData || hasBmsData) && (
          <div className="mt-3 flex items-center justify-center gap-2">
            {heartRateBpm != null && (
              <span className="flex items-center gap-1 text-sm tabular-nums text-foreground">
                <Heart className="h-4 w-4 text-destructive animate-pulse" /> {heartRateBpm}
              </span>
            )}
            <SidecarDataChips hasVescData={hasVescData} hasBmsData={hasBmsData} hasHeartRateData={heartRateBpm != null} />
          </div>
        )}
      </div>

      <button
        type="button"
        className="relative flex h-28 w-28 items-center justify-center rounded-full select-none touch-none"
        aria-label={t("laptimer.holdToUnlock")}
        {...handlers}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={RING_RADIUS} className="fill-none stroke-muted" strokeWidth={6} />
          <circle
            cx="50"
            cy="50"
            r={RING_RADIUS}
            className="fill-none stroke-primary"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
          />
        </svg>
        <LockOpen className="h-8 w-8 text-foreground" />
      </button>

      <div className="max-w-xs">
        <p className="text-sm font-medium text-foreground">{t("laptimer.holdToUnlock")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("laptimer.lockedHint")}</p>
      </div>
    </div>
  );
}
