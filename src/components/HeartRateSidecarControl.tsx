import { Heart, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeartRateSidecarController } from "@/hooks/useHeartRateSidecar";

/**
 * "+ Add Heart Rate" — a fourth optional BLE connection alongside a primary
 * live capture and the VESC/BMS sidecars (issue #87). Mirrors
 * `VescSidecarControl.tsx`/`BmsSidecarControl.tsx`'s structure exactly.
 */
export function HeartRateSidecarControl({ heartRate }: { heartRate: HeartRateSidecarController }) {
  if (heartRate.status === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={() => void heartRate.connect()} className="gap-1.5">
        <Heart className="w-3.5 h-3.5" /> + Add Heart Rate
      </Button>
    );
  }

  if (heartRate.status === "connecting") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for you to pick your heart-rate monitor…
      </p>
    );
  }

  if (heartRate.status === "error") {
    return (
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2 text-destructive">
          <span>{heartRate.error}</span>
          <Button variant="ghost" size="sm" onClick={() => void heartRate.connect()}>Retry</Button>
        </div>
        <p className="text-muted-foreground">
          On an Apple Watch, this needs an active Workout session — it doesn't broadcast heart rate
          otherwise. On a chest strap, a dry electrode is the most common reason a paired device
          shows no data.
        </p>
      </div>
    );
  }

  // connected
  const noContact = heartRate.latest?.contactDetected === false;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-foreground">
        <Heart className={`w-3.5 h-3.5 text-primary ${heartRate.latest ? "animate-pulse" : ""}`} />
        {heartRate.deviceName} · {heartRate.sampleCount.toLocaleString()} readings
      </span>
      {heartRate.latest && (
        <span className="tabular-nums text-muted-foreground">
          {heartRate.latest.bpm} bpm
        </span>
      )}
      {noContact && (
        <span className="text-destructive" title="The strap isn't detecting skin contact">
          no contact
        </span>
      )}
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void heartRate.disconnect()} title="Disconnect heart-rate monitor">
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
