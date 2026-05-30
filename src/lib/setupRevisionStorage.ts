// IndexedDB CRUD for the immutable "setup-revisions" store.
//
// Revisions are content-addressed (id = SHA-256 of the setup content), so they
// are write-once and dedup naturally: freezing an unchanged setup re-derives the
// same id and is a no-op. The pure freeze/hash logic lives in `setupRevision.ts`.

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { getSetup } from './setupStorage';
import { getTemplate } from './templateStorage';
import { buildSetupRevision, type SetupRevision } from './setupRevision';

const STORE = STORE_NAMES.SETUP_REVISIONS;

export async function getSetupRevision(id: string): Promise<SetupRevision | null> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(id);
  const result = await new Promise<SetupRevision | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function listSetupRevisions(): Promise<SetupRevision[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll();
  const results = await new Promise<SetupRevision[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

async function putRevision(rev: SetupRevision): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(rev);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Freeze the current state of a live setup into an immutable, content-addressed
 * revision and return its id (hash). Idempotent: if a revision with the same
 * content already exists, the existing one is kept (original createdAt preserved,
 * no write, no sync churn). Returns null if the setup no longer exists.
 */
export async function freezeSetupRevision(setupId: string): Promise<string | null> {
  const setup = await getSetup(setupId);
  if (!setup) return null;
  const template = setup.templateId ? await getTemplate(setup.templateId) : null;
  const rev = await buildSetupRevision({ setup, template });

  const existing = await getSetupRevision(rev.id);
  if (existing) return existing.id; // dedup — same content, keep the original revision

  await putRevision(rev);
  emitGarageChange({ store: STORE, key: rev.id, type: "put" });
  return rev.id;
}
