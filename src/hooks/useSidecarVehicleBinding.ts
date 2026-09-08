/**
 * The first time a VESC or BMS sidecar (issues #58, #73) actually reports
 * live data — not just a successful BLE handshake — remember its device name
 * on a Vehicle profile so pairing is faster next session. Shared by every
 * surface that connects these sidecars (`RaceBoxLiveRecord`,
 * `DragyLiveRecord`, the phone-GPS Lap Timer) so the behavior is consistent
 * regardless of which primary GPS source started the capture.
 *
 * `planSidecarVehicleBinding` (pure) makes the actual decision; this hook
 * just watches the two sidecar controllers, fires it once per (kind, device
 * name) pair, and applies the result.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useVehicleManager } from "./useVehicleManager";
import { planSidecarVehicleBinding, type SidecarKind } from "@/lib/live/sidecarVehicleBinding";
import type { VescSidecarController } from "./useVescSidecar";
import type { BmsSidecarController } from "./useBmsSidecar";

export function useSidecarVehicleBinding(vesc: VescSidecarController, bms: BmsSidecarController): void {
  const { vehicles, addVehicle, updateVehicle } = useVehicleManager();

  // Each (kind, device name) pair is only ever attempted once per mount —
  // read only from effects/event handlers, never during render.
  const attempted = useRef(new Set<string>());

  // Re-created every render, so it always closes over the latest `vehicles`
  // — the effects below only re-run when a sidecar's own status/name/count
  // changes, at which point they invoke that render's freshest `bind`.
  const bind = (kind: SidecarKind, deviceName: string) => {
    const key = `${kind}:${deviceName}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);

    const plan = planSidecarVehicleBinding(vehicles, kind, deviceName);
    if (plan.action === "none") return;
    if (plan.action === "create") {
      void addVehicle(plan.vehicle).then(() => {
        toast.success(`Saved ${deviceName} to a new board profile in your Garage`);
      });
    } else {
      void updateVehicle(plan.vehicle).then(() => {
        toast.success(`Saved ${deviceName} to ${plan.vehicle.name} in your Garage`);
      });
    }
  };

  useEffect(() => {
    if (vesc.status === "connected" && vesc.deviceName && vesc.sampleCount > 0) {
      bind("vesc", vesc.deviceName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesc.status, vesc.deviceName, vesc.sampleCount]);

  useEffect(() => {
    if (bms.status === "connected" && bms.deviceName && bms.sampleCount > 0) {
      bind("bms", bms.deviceName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bms.status, bms.deviceName, bms.sampleCount]);
}
