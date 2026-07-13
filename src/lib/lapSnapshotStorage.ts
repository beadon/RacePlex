// IndexedDB CRUD for the "lap-snapshots" object store.
//
// Local-first and unlimited on-device (the cloud count quota is enforced
// server-side by the sync plugin). Saving emits a garage change so the cloud-sync
// plugin can push it; unlike garage docs, a local DELETE never propagates to the
// cloud (the sync plugin ignores snapshot deletes) — the cloud copy is removed
// only explicitly from the profile page, just like the log menu.

import { openDB, STORE_NAMES } from "./dbUtils";
import { emitGarageChange } from "./garageEvents";
import { activeUserIdOrDefault } from "./localUserStorage";
import type { LapSnapshot } from "./lapSnapshot";

const STORE = STORE_NAMES.LAP_SNAPSHOTS;

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All snapshots for the active user (plan 0011), newest first. */
export async function listSnapshots(): Promise<LapSnapshot[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqPromise<LapSnapshot[]>(tx.objectStore(STORE).getAll());
  db.close();
  const uid = activeUserIdOrDefault();
  return all
    .filter((s) => s.userId === uid)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Snapshots for one course (any engine) belonging to the active user (plan 0011),
 * sorted fastest-first.
 */
export async function listSnapshotsForCourse(courseKey: string): Promise<LapSnapshot[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqPromise<LapSnapshot[]>(tx.objectStore(STORE).index("courseKey").getAll(courseKey));
  db.close();
  const uid = activeUserIdOrDefault();
  return all
    .filter((s) => s.userId === uid)
    .sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

export async function getSnapshot(id: string): Promise<LapSnapshot | null> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const result = await reqPromise<LapSnapshot | undefined>(tx.objectStore(STORE).get(id));
  db.close();
  return result ?? null;
}

/** Save (or replace) a snapshot and notify the sync plugin to push it. */
export async function saveSnapshot(snap: LapSnapshot): Promise<void> {
  await putSnapshotRaw({
    ...snap,
    userId: snap.userId ?? activeUserIdOrDefault(),
    updatedAt: Date.now(),
  });
  emitGarageChange({ store: STORE, key: snap.id, type: "put" });
}

/**
 * Write without emitting a garage event or re-stamping — the cloud pull path
 * (mirrors the sync engine's `putOne`), so a pulled snapshot doesn't echo back.
 * Preserves the caller-provided userId (from the cloud record); only defaults
 * when absent so pre-plan-0011 records still land on the active user.
 */
export async function putSnapshotRaw(snap: LapSnapshot): Promise<void> {
  const stamped: LapSnapshot = {
    ...snap,
    userId: snap.userId ?? activeUserIdOrDefault(),
  };
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Delete locally. The cloud copy is untouched (deletes don't propagate). */
export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE, key: id, type: "delete" });
}
