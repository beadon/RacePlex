/**
 * Sample boards — flagship e-skateboard presets.
 *
 * RacePlex riders type a lot of board data by hand (engine, weight,
 * drivetrain, battery, deck, wheels…) when they add a vehicle + setup. These
 * presets prefill both forms from the published specs of each vendor's
 * top-of-the-line board, so a user picks their board instead of typing it.
 *
 * Data was researched on 2026-09-07 (see `SAMPLE_BOARD_CHECKED_AT`) from the
 * vendors' own sites; every entry carries its `sourceUrl`. Specs that vendors
 * do not publish are left as null/undefined rather than guessed.
 *
 * Note: Boosted was on the original vendor list but is no longer in business
 * (site offline as of the check date), so it has no preset.
 */

import type { Vehicle } from "./vehicleStorage";
import type { VehicleSetup } from "./setupStorage";

/** When the specs below were checked against the vendor sites. */
export const SAMPLE_BOARD_CHECKED_AT = "2026-09-07";

/** Vehicle-form fields a preset may fill (all optional on `Vehicle`). */
export type SampleBoardVehicleFields = Partial<
  Pick<
    Vehicle,
    | "drivetrain"
    | "truckType"
    | "truckTypeOther"
    | "batteryVoltageNominalV"
    | "batteryCells"
    | "batteryCellChemistry"
    | "batteryCapacityWh"
    | "batteryContinuousDischargeA"
    | "batteryBmsMake"
  >
>;

export interface SampleBoard {
  /** Stable slug, used as the preset Select value. */
  id: string;
  brand: string;
  model: string;
  /** Vendor page the specs were taken from. */
  sourceUrl: string;
  /** As listed on the source page at check time (display-only). */
  price?: string;
  /** Marketing numbers for display; not imported into any form. */
  highlights?: {
    topSpeed?: string;
    range?: string;
    hill?: string;
    maxLoad?: string;
  };
  /** Prefills the Vehicles form (drivetrain, trucks, battery pack). */
  vehicle: SampleBoardVehicleFields;
  /** Prefills `Vehicle.engine` — the leaderboard-facing name. */
  engine: string;
  /** Board-only weight in kg; prefills `Vehicle.weight` (rider adjusts). */
  weightKg?: number;
  /** Prefills the eSkateboard setup form (field ids from DEFAULT_ESKATE_TEMPLATE). */
  setup: {
    /** Present keys only — fields the vendor doesn't publish are omitted. */
    customFields: Record<string, string | number>;
    tireBrand?: string;
    /** Applied to all four corners when known. */
    tireDiameterMm?: number | null;
    tireWidthMm?: number | null;
  };
  /** Anything else worth surfacing next to the preset (ESC, build notes…). */
  notes?: string;
}

export const SAMPLE_BOARDS: SampleBoard[] = [
  {
    id: "lacroix-nazare-supersport",
    brand: "Lacroix",
    model: "Nazaré Supersport",
    sourceUrl: "https://www.lacroixboards.com/products/nazare-supersport™",
    highlights: {
      topSpeed: "45+ mph",
      range: "20–40 mi (34–64 km)",
      hill: "40%",
    },
    vehicle: {
      drivetrain: "belt",
      truckType: "other",
      truckTypeOther: "Hypertruck (7075AL DH suspension)",
      batteryCells: 18,
      batteryVoltageNominalV: 64.8,
      batteryCellChemistry: "Li-ion",
      batteryCapacityWh: 1088,
    },
    engine: "2× Vesta 6485 138kv (7026W max each)",
    weightKg: 17.7,
    setup: {
      customFields: {
        "f-deck-length": 1003, // 39.5" deck with angled tabs
        "f-wheelbase": 927, // 36.5" axle c/c
        "f-truck-type": "Hypertruck (7075AL, spring suspension)",
        "f-truck-width": 483, // 19" hanger
        "f-wheel-type": "pneumatic (Kenda on MBS hubs)",
        "f-drive-type": "belt (self-tensioning)",
        "f-motor-kv": 138,
        "f-cell-config": "18S4P Molicel P42A",
        "f-capacity-wh": 1088,
      },
      tireBrand: "Kenda (MBS hub)",
    },
    notes:
      "Stormcore 2.0 ESC (22S capable, 140A sustained per motor); 4 RipTide bushing sets included; ships with full spare MBS wheel.",
  },
  {
    id: "stooge-v7-cst",
    brand: "Stooge Race Boards",
    model: "V7 CST (2WD 30kW)",
    sourceUrl: "https://www.stoogeraceboards.com/collections/race-boards",
    price: "from $2,040 (bare chassis); 30kW build by quote",
    vehicle: {
      drivetrain: "gear",
      truckType: "other",
      truckTypeOther: "CST (canard spherical truck)",
      batteryCells: 16,
      batteryVoltageNominalV: 57.6,
      batteryCellChemistry: "LiPo",
      batteryCapacityWh: 1250,
      batteryBmsMake: "Charge-only BMS",
    },
    engine: "2× 6094 150KV, JK ESC",
    setup: {
      customFields: {
        "f-wheelbase": 1092, // 43" minimum; adjustable to 46" (1168mm)
        "f-truck-type": "CST canard spherical (angle/ratio adjustable)",
        "f-truck-width": 432, // 17" hanger
        "f-wheel-type": "pneumatic (Vega cold-track)",
        "f-drive-type": "gear (enclosed steel, 2WD)",
        "f-motor-kv": 150,
        "f-wheel-pulley": 78, // 78T open spurs
        "f-cell-config": "16S LiPo 1250Wh",
        "f-capacity-wh": 1250,
      },
      tireBrand: "Vega (Douglass wheels)",
    },
    notes:
      "Handmade raceboard; AWD 15kW and 2WD 30kW builds; 15A charger. Vendor does not publish top speed.",
  },
  {
    id: "radium-mach-one-s",
    brand: "Radium Performance",
    model: "Mach One S",
    sourceUrl: "https://radium-performance.com/",
    price: "$3,899 (first batch of 25, shipped May 2026)",
    highlights: {
      topSpeed: "70 km/h (44 mph)",
      range: "50 km (70A wheels, 85 kg rider)",
      maxLoad: "120 kg",
    },
    vehicle: {
      drivetrain: "belt",
      truckType: "other",
      truckTypeOther: "R6 (swing-arm suspension)",
      batteryCells: 18,
      // Vendor quotes 75.6V, the fully-charged 18S pack voltage; nominal is 18 × 3.6V.
      batteryVoltageNominalV: 64.8,
      batteryCellChemistry: "Li-ion",
      batteryCapacityWh: 1296,
    },
    engine: "2× F55 Darkstar 6485 130kv",
    weightKg: 18.5,
    setup: {
      customFields: {
        "f-truck-type": "R6 (swing-arm suspension)",
        "f-wheel-type": "hybrid airless rubber (SR125 V3)",
        "f-drive-type": "belt (Optibelt OMEGA HP)",
        "f-motor-kv": 130,
        "f-motor-pulley": 16,
        "f-wheel-pulley": 45, // 16/45T = 3.00
        "f-cell-config": "18S4P Samsung INR21700-50S",
        "f-capacity-wh": 1296,
      },
      tireBrand: "Radium SR125 V3",
      tireDiameterMm: 125,
      tireWidthMm: 75,
    },
    notes:
      "6000W system; JK ESC; carbon monocoque chassis with swing-arm suspension, bamboo-core composite deck; Kegel-compatible (85–165 mm wheels); Riptide Krank + Radium RS front bushings.",
  },
  {
    id: "evolve-diablo-carbon",
    brand: "Evolve",
    model: "Diablo Carbon (Street)",
    sourceUrl: "https://evolveskateboards.com/products/diablo-carbon-street",
    highlights: {
      topSpeed: "50 km/h (31 mph)",
      range: "up to 80 km (50 mi)",
      hill: "45%+",
      maxLoad: "120 kg",
    },
    vehicle: {
      truckType: "Stock",
      batteryCells: 12,
      batteryVoltageNominalV: 43.2,
      batteryCellChemistry: "Li-ion",
      batteryCapacityWh: 864,
      batteryContinuousDischargeA: 180, // Samsung 50S max discharge
    },
    engine: "2× 6374 3500W sensored (7000W total)",
    weightKg: 13.1,
    setup: {
      customFields: {
        "f-deck-length": 1000, // 100 cm
        "f-wheelbase": 965, // 96.5 cm
        "f-truck-type": "Supercarve 2 (forged/CNC)",
        "f-wheel-type": "urethane",
        "f-wheel-duro-front": 76,
        "f-wheel-duro-rear": 76,
        "f-cell-config": "12S2P Samsung 50S (20Ah)",
        "f-capacity-wh": 864,
      },
      tireBrand: "Evolve custom formula",
      tireDiameterMm: 97,
    },
    notes:
      "eFOC 2 ESC (50V 200A dual-motor, FOC); forged carbon deck; Phaze remote; 4 h recharge; motor kV not published.",
  },
];

type VehicleForm = Omit<Vehicle, "id">;
type SetupForm = Omit<VehicleSetup, "id" | "createdAt" | "updatedAt">;

/**
 * Prefill a vehicle form from a preset. Keeps anything the user already typed
 * (name) but takes the preset's engine/drivetrain/trucks/battery/weight.
 */
export function applySampleBoardToVehicle(form: VehicleForm, board: SampleBoard): VehicleForm {
  return {
    ...form,
    name: form.name.trim() ? form.name : `${board.brand} ${board.model}`,
    engine: board.engine,
    ...board.vehicle,
    ...(board.weightKg != null ? { weight: board.weightKg, weightUnit: "kg" as const } : {}),
  };
}

/**
 * Prefill an eSkateboard setup form from a preset. Merges the preset's
 * custom fields over whatever is already there and fills the tire block when
 * the vendor publishes sizes.
 */
export function applySampleBoardToSetup(form: SetupForm, board: SampleBoard): SetupForm {
  const s = board.setup;
  const d = s.tireDiameterMm ?? null;
  const w = s.tireWidthMm ?? null;
  return {
    ...form,
    name: form.name.trim() ? form.name : `${board.brand} ${board.model}`,
    tireBrand: s.tireBrand ?? form.tireBrand,
    tireDiameterFrontLeft: d ?? form.tireDiameterFrontLeft,
    tireDiameterFrontRight: d ?? form.tireDiameterFrontRight,
    tireDiameterRearLeft: d ?? form.tireDiameterRearLeft,
    tireDiameterRearRight: d ?? form.tireDiameterRearRight,
    tireWidthFrontLeft: w ?? form.tireWidthFrontLeft,
    tireWidthFrontRight: w ?? form.tireWidthFrontRight,
    tireWidthRearLeft: w ?? form.tireWidthRearLeft,
    tireWidthRearRight: w ?? form.tireWidthRearRight,
    customFields: { ...form.customFields, ...s.customFields },
  };
}
