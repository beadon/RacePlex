/**
 * Remember a paired VESC/BMS sidecar's BLE device name on a Vehicle profile
 * (issues #58, #73), so a rider doesn't have to hunt through the Bluetooth
 * picker for the right device on every future session.
 *
 * Pure decision logic only — no IndexedDB, no React. The caller (
 * `useSidecarVehicleBinding.ts`) supplies the current vehicle list and
 * applies whichever action comes back.
 */
import type { Vehicle } from "@/lib/vehicleStorage";
import { NEW_VEHICLE_DEFAULT_TYPE_ID } from "@/lib/templateStorage";

export type SidecarKind = "vesc" | "bms";

export type SidecarVehicleBindingPlan =
  | { action: "none" }
  | { action: "update"; vehicle: Vehicle }
  | { action: "create"; vehicle: Omit<Vehicle, "id"> };

function fieldFor(kind: SidecarKind): "vescDeviceName" | "bmsDeviceName" {
  return kind === "vesc" ? "vescDeviceName" : "bmsDeviceName";
}

/** A brand-new "board" vehicle, pre-filled with the paired device name. */
function buildDefaultBoardVehicle(kind: SidecarKind, deviceName: string): Omit<Vehicle, "id"> {
  return {
    name: "My Board",
    vehicleTypeId: NEW_VEHICLE_DEFAULT_TYPE_ID,
    // The Add-Vehicle form requires a non-empty engine (it powers leaderboard/
    // snapshot matching) — a placeholder keeps this consistent with every
    // hand-created vehicle rather than leaving a blank the UI would reject.
    engine: "VESC",
    number: 0,
    weight: 0,
    weightUnit: "lb",
    [fieldFor(kind)]: deviceName,
  };
}

/**
 * Decide what to do the first time a sidecar reports real data. Only acts
 * when the outcome is unambiguous:
 *  - this exact device is already remembered on some vehicle → nothing to do
 *  - no vehicles exist yet → create one, seeded with this device name
 *  - exactly one vehicle exists → attach the device name to it
 *  - more than one vehicle exists → do nothing rather than guess which
 *    board this sidecar belongs to
 */
export function planSidecarVehicleBinding(
  vehicles: Vehicle[],
  kind: SidecarKind,
  deviceName: string,
): SidecarVehicleBindingPlan {
  const field = fieldFor(kind);
  if (vehicles.some((v) => v[field] === deviceName)) return { action: "none" };
  if (vehicles.length === 0) return { action: "create", vehicle: buildDefaultBoardVehicle(kind, deviceName) };
  if (vehicles.length === 1) return { action: "update", vehicle: { ...vehicles[0], [field]: deviceName } };
  return { action: "none" };
}
