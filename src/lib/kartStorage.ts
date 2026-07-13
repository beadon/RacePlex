/**
 * IndexedDB CRUD for the "karts" object store — the legacy alias for vehicles,
 * kept for back-compat with older consumers. Shares the same object store as
 * vehicleStorage.ts; user-scoping mirrors that module (plan 0011).
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { activeUserIdOrDefault } from './localUserStorage';

export interface Kart {
  id: string;
  name: string;
  engine: string;
  number: number;
  weight: number;
  weightUnit: "lb" | "kg";
  /**
   * Owning local user (plan 0011). Stamped by saveKart when missing; listKarts
   * filters on the active user's id.
   */
  userId?: string;
}

const KARTS_STORE = STORE_NAMES.KARTS;

export async function saveKart(kart: Kart): Promise<void> {
  const stamped: Kart = {
    ...kart,
    userId: kart.userId ?? activeUserIdOrDefault(),
  };
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readwrite");
  tx.objectStore(KARTS_STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listKarts(): Promise<Kart[]> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readonly");
  const request = tx.objectStore(KARTS_STORE).getAll();
  const results = await new Promise<Kart[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const uid = activeUserIdOrDefault();
  return results.filter((k) => k.userId === uid);
}

export async function getKart(id: string): Promise<Kart | null> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readonly");
  const request = tx.objectStore(KARTS_STORE).get(id);
  const result = await new Promise<Kart | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function deleteKart(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readwrite");
  tx.objectStore(KARTS_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
