import { Battery, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BmsSidecarController } from "@/hooks/useBmsSidecar";

/**
 * "+ Add BMS" — an optional third BLE connection alongside a primary live
 * capture and the optional VESC sidecar (issue #73). Mirrors
 * `VescSidecarControl.tsx`'s structure exactly.
 */
export function BmsSidecarControl({ bms }: { bms: BmsSidecarController }) {
  if (bms.status === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={() => void bms.connect()} className="gap-1.5">
        <Battery className="w-3.5 h-3.5" /> + Add BMS
      </Button>
    );
  }

  if (bms.status === "connecting") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for you to pick your BMS…
      </p>
    );
  }

  if (bms.status === "error") {
    return (
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2 text-destructive">
          <span>{bms.error}</span>
          <Button variant="ghost" size="sm" onClick={() => void bms.connect()}>Retry</Button>
        </div>
        {/* Confirmed in practice on a real JBD-family BMS: the vendor's own
            app can silently reconnect to it in the background even after
            being "disconnected" via the OS Bluetooth settings, which then
            blocks a fresh connection here the same way a VESC connection
            gets blocked by VESC Tool — worth saying plainly. */}
        <p className="text-muted-foreground">
          Usually only one app can be connected to a BMS's Bluetooth at a time — close the BMS
          vendor app (it may reconnect in the background even if you didn't reopen it) and try again.
        </p>
      </div>
    );
  }

  // connected
  const b = bms.latest?.basicInfo;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1.5 text-foreground">
        <Battery className="w-3.5 h-3.5 text-primary" />
        {bms.deviceName} · {bms.sampleCount.toLocaleString()} readings
      </span>
      {b && (
        <span className="tabular-nums text-muted-foreground">
          {b.voltageV.toFixed(1)} V · {b.currentA.toFixed(1)} A · {b.socPct}%
        </span>
      )}
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void bms.disconnect()} title="Disconnect BMS">
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
