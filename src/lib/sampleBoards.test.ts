import { describe, it, expect } from "vitest";
import {
  SAMPLE_BOARDS,
  SAMPLE_BOARD_CHECKED_AT,
  applySampleBoardToVehicle,
  applySampleBoardToSetup,
  type SampleBoard,
} from "./sampleBoards";
import { DEFAULT_ESKATE_TEMPLATE } from "./templateStorage";
import type { Vehicle } from "./vehicleStorage";
import type { VehicleSetup } from "./setupStorage";

// Raceboard geometries that legitimately exceed the default eSkate template's
// input ranges — the template limits are built around street boards, the
// preset data is correct as published. Tests enforce that ONLY these entries
// are out of range, so a stray bad value fails the suite.
const KNOWN_OUT_OF_RANGE: Record<string, string[]> = {
  "lacroix-nazare-supersport": ["f-truck-width"],
  "stooge-v7-cst": ["f-wheelbase", "f-truck-width"],
};

const emptyVehicleForm = (): Omit<Vehicle, "id"> => ({
  name: "",
  vehicleTypeId: "default-eskate-type",
  engine: "",
  number: 0,
  weight: 0,
  weightUnit: "lb",
});

const emptySetupForm = (): Omit<VehicleSetup, "id" | "createdAt" | "updatedAt"> => ({
  vehicleId: "v1",
  templateId: "default-eskate-template",
  name: "",
  unitSystem: "mm",
  tireBrand: "",
  psiMode: "single",
  psiFrontLeft: null,
  psiFrontRight: null,
  psiRearLeft: null,
  psiRearRight: null,
  tireWidthMode: "halves",
  tireWidthFrontLeft: null,
  tireWidthFrontRight: null,
  tireWidthRearLeft: null,
  tireWidthRearRight: null,
  tireDiameterMode: "halves",
  tireDiameterFrontLeft: null,
  tireDiameterFrontRight: null,
  tireDiameterRearLeft: null,
  tireDiameterRearRight: null,
  customFields: {},
});

const templateFields = new Map(
  DEFAULT_ESKATE_TEMPLATE.sections.flatMap(s => s.fields).map(f => [f.id, f]),
);

describe("sampleBoards", () => {
  it("records the spec-check date", () => {
    expect(SAMPLE_BOARD_CHECKED_AT).toBe("2026-09-07");
  });

  it("has unique, well-formed entries", () => {
    const ids = new Set<string>();
    for (const b of SAMPLE_BOARDS) {
      expect(b.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
      expect(b.brand.trim()).not.toBe("");
      expect(b.model.trim()).not.toBe("");
      expect(b.engine.trim()).not.toBe("");
      expect(b.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("only references default eSkate template field ids", () => {
    for (const b of SAMPLE_BOARDS) {
      for (const key of Object.keys(b.setup.customFields)) {
        expect(templateFields.has(key), `${b.id}: unknown field "${key}"`).toBe(true);
      }
    }
  });

  it("keeps numeric fields inside template ranges, except the documented raceboard exceptions", () => {
    const seenOutOf: Record<string, string[]> = {};
    for (const b of SAMPLE_BOARDS) {
      for (const [key, value] of Object.entries(b.setup.customFields)) {
        if (typeof value !== "number") continue;
        const field = templateFields.get(key);
        if (!field || field.type !== "number") continue;
        const inRange =
          (field.min == null || value >= field.min) && (field.max == null || value <= field.max);
        if (!inRange) {
          (seenOutOf[b.id] ??= []).push(key);
        }
      }
    }
    expect(seenOutOf).toEqual(KNOWN_OUT_OF_RANGE);
  });

  it("keeps battery data internally consistent (S-count vs nominal voltage)", () => {
    for (const b of SAMPLE_BOARDS) {
      const v = b.vehicle;
      if (v.batteryCells && v.batteryVoltageNominalV) {
        // 3.6V nominal per Li-ion/LiPo cell; allow 0.6V tolerance.
        expect(Math.abs(v.batteryCells * 3.6 - v.batteryVoltageNominalV)).toBeLessThanOrEqual(0.6);
      }
      if (v.batteryCapacityWh) {
        expect(v.batteryCapacityWh).toBeGreaterThan(0);
      }
    }
  });

  it("applies vehicle presets to an empty form", () => {
    for (const b of SAMPLE_BOARDS) {
      const form = applySampleBoardToVehicle(emptyVehicleForm(), b);
      expect(form.name).toBe(`${b.brand} ${b.model}`);
      expect(form.engine).toBe(b.engine);
      expect(form.vehicleTypeId).toBe("default-eskate-type");
      if (b.weightKg != null) {
        expect(form.weight).toBe(b.weightKg);
        expect(form.weightUnit).toBe("kg");
      }
      for (const [k, v] of Object.entries(b.vehicle)) {
        expect(form[k as keyof typeof form]).toBe(v);
      }
    }
  });

  it("keeps a user-typed name when applying a vehicle preset", () => {
    const b = SAMPLE_BOARDS[0];
    const form = applySampleBoardToVehicle({ ...emptyVehicleForm(), name: "My Race Board" }, b);
    expect(form.name).toBe("My Race Board");
    expect(form.engine).toBe(b.engine);
  });

  it("applies setup presets to an empty form", () => {
    for (const b of SAMPLE_BOARDS) {
      const form = applySampleBoardToSetup(emptySetupForm(), b);
      expect(form.name).toBe(`${b.brand} ${b.model}`);
      expect(Object.entries(b.setup.customFields).every(([k, v]) => form.customFields[k] === v)).toBe(true);
      if (b.setup.tireBrand) {
        expect(form.tireBrand).toBe(b.setup.tireBrand);
      }
      if (b.setup.tireDiameterMm) {
        expect(form.tireDiameterFrontLeft).toBe(b.setup.tireDiameterMm);
        expect(form.tireDiameterRearRight).toBe(b.setup.tireDiameterMm);
      }
      if (b.setup.tireWidthMm) {
        expect(form.tireWidthFrontRight).toBe(b.setup.tireWidthMm);
      }
    }
  });

  it("does not clobber existing setup values when applying a preset", () => {
    const b = SAMPLE_BOARDS.find(x => x.id === "evolve-diablo-carbon")!;
    const pre: Omit<VehicleSetup, "id" | "createdAt" | "updatedAt"> = {
      ...emptySetupForm(),
      name: "My Setup",
      customFields: { "f-deck-length": 1234 },
      tireDiameterFrontLeft: 111,
    };
    const form = applySampleBoardToSetup(pre, b);
    expect(form.name).toBe("My Setup");
    expect(form.customFields["f-deck-length"]).toBe(b.setup.customFields["f-deck-length"]);
    expect(form.tireDiameterFrontLeft).toBe(b.setup.tireDiameterMm); // preset fills tire sizes
    // Fields the preset doesn't carry keep the existing value.
    const other = SAMPLE_BOARDS.find(x => x.id === "radium-mach-one-s") as SampleBoard;
    const form2 = applySampleBoardToSetup({ ...pre, customFields: {} }, other);
    expect(form2.tireDiameterFrontLeft).toBe(125);
    expect(form2.tireWidthFrontLeft).toBe(75);
  });
});
