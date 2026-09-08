import { Bluetooth, Loader2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VescSidecarController } from "@/hooks/useVescSidecar";

/**
 * "+ Add VESC" — an optional second BLE connection alongside a primary live
 * capture (issue #58). Shown in `RaceBoxLiveRecord`/`DragyLiveRecord` while
 * `phase === "recording"`, so it's clear both connections are things the
 * rider tracks side by side, not one gating the other.
 */
export function VescSidecarControl({ vesc }: { vesc: VescSidecarController }) {
  if (vesc.status === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={() => void vesc.connect()} className="gap-1.5">
        <Zap className="w-3.5 h-3.5" /> + Add VESC
      </Button>
    );
  }

  if (vesc.status === "connecting") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for you to pick your VESC…
      </p>
    );
  }

  if (vesc.status === "error") {
    return (
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2 text-destructive">
          <span>{vesc.error}</span>
          <Button variant="ghost" size="sm" onClick={() => void vesc.connect()}>Retry</Button>
        </div>
        {/* Confirmed in practice: a VESC only accepts one BLE central at a
            time, so a stuck "Connection attempt failed" is very often VESC
            Tool (or another tab) still holding the connection, not a real
            fault — worth saying plainly rather than leaving a rider stuck
            retrying a connection that can never succeed while that's true. */}
        <p className="text-muted-foreground">
          Usually only one app can be connected to a VESC's Bluetooth at a time — close VESC Tool
          (or any other app connected to it) and try again.
        </p>
      </div>
    );
  }

  // connected
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-foreground">
        <Bluetooth className="w-3.5 h-3.5 text-primary" />
        {vesc.deviceName} · {vesc.sampleCount.toLocaleString()} readings
      </span>
      {vesc.latest && (
        <span className="tabular-nums text-muted-foreground">
          {vesc.latest.batteryCurrentA.toFixed(1)} A · {vesc.latest.batteryVoltageV.toFixed(1)} V
        </span>
      )}
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void vesc.disconnect()} title="Disconnect VESC">
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
