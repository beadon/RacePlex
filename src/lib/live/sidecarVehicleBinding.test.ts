import { describe, it, expect } from "vitest";
import { planSidecarVehicleBinding } from "./sidecarVehicleBinding";
import type { Vehicle } from "@/lib/vehicleStorage";

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    name: "My Board",
    vehicleTypeId: "default-eskate-type",
    engine: "VESC",
    number: 0,
    weight: 0,
    weightUnit: "lb",
    ...over,
  };
}

describe("planSidecarVehicleBinding", () => {
  it("creates a new vehicle seeded with the device name when the garage is empty", () => {
    const plan = planSidecarVehicleBinding([], "vesc", "MyVesc");
    expect(plan.action).toBe("create");
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.vehicle.vescDeviceName).toBe("MyVesc");
    expect(plan.vehicle.vehicleTypeId).toBe("default-eskate-type");
    expect(plan.vehicle.engine).not.toBe("");
  });

  it("attaches the device name to the single existing vehicle", () => {
    const existing = vehicle({ id: "v1" });
    const plan = planSidecarVehicleBinding([existing], "bms", "MyBms");
    expect(plan.action).toBe("update");
    if (plan.action !== "update") throw new Error("unreachable");
    expect(plan.vehicle.id).toBe("v1");
    expect(plan.vehicle.bmsDeviceName).toBe("MyBms");
  });

  it("fills the other sidecar slot on the same vehicle without disturbing the first", () => {
    const existing = vehicle({ id: "v1", vescDeviceName: "MyVesc" });
    const plan = planSidecarVehicleBinding([existing], "bms", "MyBms");
    expect(plan.action).toBe("update");
    if (plan.action !== "update") throw new Error("unreachable");
    expect(plan.vehicle.vescDeviceName).toBe("MyVesc");
    expect(plan.vehicle.bmsDeviceName).toBe("MyBms");
  });

  it("does nothing once this exact device is already remembered", () => {
    const existing = vehicle({ id: "v1", vescDeviceName: "MyVesc" });
    const plan = planSidecarVehicleBinding([existing], "vesc", "MyVesc");
    expect(plan.action).toBe("none");
  });

  it("does nothing with multiple existing vehicles — refuses to guess which board", () => {
    const plan = planSidecarVehicleBinding(
      [vehicle({ id: "v1", name: "Board A" }), vehicle({ id: "v2", name: "Board B" })],
      "vesc",
      "MyVesc",
    );
    expect(plan.action).toBe("none");
  });
});
