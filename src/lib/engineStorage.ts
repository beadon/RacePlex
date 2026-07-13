/**
 * IndexedDB CRUD for the "engines" object store — a reusable list of engine
 * types users build up while creating vehicles. Each write/delete emits a
 * garage change so the cloud-sync plugin can carry it across devices.
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { activeUserIdOrDefault } from './localUserStorage';

/**
 * Motor family. Almost every eskate motor is BLDC; PMSM/DC are present so the
 * field models the real world honestly. Free-form via `motorKindOther`.
 */
export type MotorKind = "BLDC" | "PMSM" | "DC" | "other";

export interface Engine {
  id: string;
  name: string;
  createdAt: number;
  /**
   * Motor family — defaults to BLDC on new engines (the overwhelming eskate
   * case). Optional so old records without the field still render cleanly.
   */
  motorKind?: MotorKind;
  /** Free-form label when `motorKind === "other"`. */
  motorKindOther?: string;
  /**
   * Owning local user (plan 0011). Stamped by saveEngine when missing; the
   * v14 back-fill migration set it on pre-existing rows. `listEngines`
   * filters on the active user's id so users don't see each other's data.
   */
  userId?: string;
  /** Last local edit time (ms) — set by saveEngine; used for sync merge. */
  updatedAt?: number;
}

const ENGINES_STORE = STORE_NAMES.ENGINES;

export async function saveEngine(engine: Engine): Promise<void> {
  const stamped: Engine = {
    ...engine,
    userId: engine.userId ?? activeUserIdOrDefault(),
    updatedAt: Date.now(),
  };
  const db = await openDB();
  const tx = db.transaction(ENGINES_STORE, "readwrite");
  tx.objectStore(ENGINES_STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: ENGINES_STORE, key: engine.id, type: "put" });
}

export async function listEngines(): Promise<Engine[]> {
  const db = await openDB();
  const tx = db.transaction(ENGINES_STORE, "readonly");
  const request = tx.objectStore(ENGINES_STORE).getAll();
  const results = await new Promise<Engine[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const uid = activeUserIdOrDefault();
  return results.filter((e) => e.userId === uid);
}

export async function deleteEngine(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(ENGINES_STORE, "readwrite");
  tx.objectStore(ENGINES_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: ENGINES_STORE, key: id, type: "delete" });
}
