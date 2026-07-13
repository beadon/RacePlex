/**
 * IndexedDB CRUD for the "karts" object store (vehicles).
 * Renamed from kartStorage.ts — the IDB store name stays "karts" for backward compat.
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { activeUserIdOrDefault } from './localUserStorage';

/** Powertrain topology of the board itself (belt drive, direct drive, hub, gear). */
export type Drivetrain = "belt" | "direct" | "hub" | "gear" | "other";

/**
 * Truck geometry. RPK, TKP, and 3-link cover most of what eskate riders build
 * on; "Stock" is the generic catch-all commercial-deck case; free-form fallback
 * via `truckTypeOther`.
 */
export type TruckType = "RPK" | "TKP" | "3-link" | "Stock" | "other";

/**
 * Battery pack cell chemistry. Li-ion covers 18650/21700-based packs (the
 * common eskate case); LiPo covers pouch packs; LiFePO4 is niche but real.
 */
export type CellChemistry = "Li-ion" | "LiPo" | "LiFePO4" | "other";

export interface Vehicle {
  id: string;
  name: string;
  vehicleTypeId: string;
  engine: string;
  number: number;
  weight: number;
  weightUnit: "lb" | "kg";
  /** Powertrain topology of the board (belt / direct / hub / gear / other). */
  drivetrain?: Drivetrain;
  /** Free-form label when `drivetrain === "other"`. */
  drivetrainOther?: string;
  /** Truck geometry (RPK / TKP / 3-link / Stock / other). */
  truckType?: TruckType;
  /** Free-form label when `truckType === "other"`. */
  truckTypeOther?: string;

  // ─── Battery pack (advanced) ──────────────────────────────────────────────
  /** Nominal pack voltage (V). */
  batteryVoltageNominalV?: number;
  /** Cells in series (13S, 14S, …) — eskate speaks in cells more than volts. */
  batteryCells?: number;
  /** Cell chemistry family. */
  batteryCellChemistry?: CellChemistry;
  /** Free-form label when `batteryCellChemistry === "other"`. */
  batteryCellChemistryOther?: string;
  /** Pack energy (Wh). */
  batteryCapacityWh?: number;
  /** Continuous discharge rating (A). */
  batteryContinuousDischargeA?: number;
  /** Burst discharge rating (A). */
  batteryBurstDischargeA?: number;
  /** BMS make (Bestech, Daly, ANT, DieBieMS, …). Free-form. */
  batteryBmsMake?: string;
  /** BMS model. Free-form. */
  batteryBmsModel?: string;

  // ─── Remote pairing (advanced) ────────────────────────────────────────────
  /** Points at a row in the `remotes` store; the store is a shared catalog. */
  pairedRemoteId?: string;
  /**
   * Opt-in: when true, a public-safe projection (name/type/engine/number — never
   * weight/setup) is published to the user's public driver profile. See plan 0006.
   */
  publicProfile?: boolean;
  /** Last local edit time (ms) — set by saveVehicle; used for sync merge. */
  updatedAt?: number;
  /**
   * Owning local user (plan 0011). Stamped by saveVehicle when missing;
   * listVehicles filters on the active user's id.
   */
  userId?: string;
}

const VEHICLES_STORE = STORE_NAMES.KARTS; // store name unchanged in IDB

export async function saveVehicle(vehicle: Vehicle): Promise<void> {
  const stamped: Vehicle = {
    ...vehicle,
    userId: vehicle.userId ?? activeUserIdOrDefault(),
    updatedAt: Date.now(),
  };
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readwrite");
  tx.objectStore(VEHICLES_STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: VEHICLES_STORE, key: vehicle.id, type: "put" });
}

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readonly");
  const request = tx.objectStore(VEHICLES_STORE).getAll();
  const results = await new Promise<Vehicle[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const uid = activeUserIdOrDefault();
  return results.filter((v) => v.userId === uid);
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readonly");
  const request = tx.objectStore(VEHICLES_STORE).get(id);
  const result = await new Promise<Vehicle | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function deleteVehicle(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readwrite");
  tx.objectStore(VEHICLES_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: VEHICLES_STORE, key: id, type: "delete" });
}
