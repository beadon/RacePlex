/**
 * IndexedDB CRUD for the "remotes" object store — a per-user catalog of eskate
 * remotes (Hoyt Puck, Flipsky VX, Maytech MTSKR, …). A vehicle can point at a
 * remote via `Vehicle.pairedRemoteId` so the rider remembers which controller
 * is paired with which board.
 *
 * Per-user (plan 0011): `saveRemote` stamps the active user's id and
 * `listRemotes` filters on it. The v15 schema creates the store; the seed
 * (`remoteCatalogSeed.ts`) is written lazily on first `listRemotes()` call
 * per user, not in the schema migration, so each user gets their own copy.
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { activeUserIdOrDefault } from './localUserStorage';
import { REMOTE_CATALOG_SEED } from './remoteCatalogSeed';

/** Radio class. `other` for anything the enum doesn't cover — free-form via `radioOther`. */
export type RemoteRadio = '2.4 GHz' | 'sub-GHz' | 'BLE' | 'other';

export interface Remote {
  id: string;
  brand: string;
  model: string;
  radio?: RemoteRadio;
  radioOther?: string;
  batteryLifeHours?: number;
  rangeMeters?: number;
  notes?: string;
  createdAt: number;
  updatedAt?: number;
  /** Owning local user (plan 0011). Stamped by saveRemote when missing. */
  userId?: string;
}

const REMOTES_STORE = STORE_NAMES.REMOTES;

/** Whether this user has been seeded with the starter catalog yet. */
async function hasAnyRemote(userId: string): Promise<boolean> {
  const db = await openDB();
  const tx = db.transaction(REMOTES_STORE, 'readonly');
  const all = await new Promise<Remote[]>((resolve, reject) => {
    const req = tx.objectStore(REMOTES_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all.some((r) => r.userId === userId);
}

async function seedCatalog(userId: string): Promise<void> {
  const now = Date.now();
  const db = await openDB();
  const tx = db.transaction(REMOTES_STORE, 'readwrite');
  const store = tx.objectStore(REMOTES_STORE);
  for (const rec of REMOTE_CATALOG_SEED) {
    store.put({ ...rec, id: `${userId}:${rec.id}`, createdAt: now, userId });
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveRemote(remote: Remote): Promise<void> {
  const stamped: Remote = {
    ...remote,
    userId: remote.userId ?? activeUserIdOrDefault(),
    updatedAt: Date.now(),
  };
  const db = await openDB();
  const tx = db.transaction(REMOTES_STORE, 'readwrite');
  tx.objectStore(REMOTES_STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: REMOTES_STORE, key: remote.id, type: 'put' });
}

export async function listRemotes(): Promise<Remote[]> {
  const uid = activeUserIdOrDefault();
  // Lazy first-run seed per user — an empty list for this user gets the
  // starter catalog written so a rider isn't looking at zero options.
  if (!(await hasAnyRemote(uid))) {
    try { await seedCatalog(uid); } catch (e) { console.warn('Remote catalog seed failed:', e); }
  }
  const db = await openDB();
  const tx = db.transaction(REMOTES_STORE, 'readonly');
  const all = await new Promise<Remote[]>((resolve, reject) => {
    const req = tx.objectStore(REMOTES_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all
    .filter((r) => r.userId === uid)
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export async function getRemote(id: string): Promise<Remote | null> {
  const db = await openDB();
  const tx = db.transaction(REMOTES_STORE, 'readonly');
  const req = tx.objectStore(REMOTES_STORE).get(id);
  const result = await new Promise<Remote | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result ?? null;
}

export async function deleteRemote(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(REMOTES_STORE, 'readwrite');
  tx.objectStore(REMOTES_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: REMOTES_STORE, key: id, type: 'delete' });
}
