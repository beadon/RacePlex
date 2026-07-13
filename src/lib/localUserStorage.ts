/**
 * Local users (plan 0011). No auth, no cloud — a "user" here is a local profile
 * on this browser install so shared machines can keep runs, garage, and
 * settings cleanly separated per rider.
 *
 * The `users` store lives in the shared IndexedDB (`raceplex`, v14+). The
 * *active* user id is a per-install piece of UI state, kept in localStorage so
 * app startup can read it synchronously (`useSettings` needs it to pick the
 * right settings key before any React tree mounts).
 */

import { openDB, STORE_NAMES, USER_SCOPED_STORES } from './dbUtils';
import { emitGarageChange } from './garageEvents';

export interface LocalUser {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
}

/** localStorage key holding the id of the currently-active user. */
export const ACTIVE_USER_KEY = 'raceplex:activeUserId';

/** Fallback name for the first user created on a fresh migration. */
export const DEFAULT_USER_NAME = 'Me';

/**
 * Fixed id for the seed user created by the v14 migration. Kept stable so tests
 * and downstream code can reference it, and so re-running the migration on an
 * already-migrated DB is a no-op.
 */
export const DEFAULT_USER_ID = 'default-user';

const USERS_STORE = STORE_NAMES.USERS;

export async function saveLocalUser(user: LocalUser): Promise<void> {
  const stamped: LocalUser = { ...user, updatedAt: Date.now() };
  const db = await openDB();
  const tx = db.transaction(USERS_STORE, 'readwrite');
  tx.objectStore(USERS_STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: USERS_STORE, key: user.id, type: 'put' });
}

export async function listLocalUsers(): Promise<LocalUser[]> {
  const db = await openDB();
  const tx = db.transaction(USERS_STORE, 'readonly');
  const request = tx.objectStore(USERS_STORE).getAll();
  const results = await new Promise<LocalUser[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results;
}

export async function getLocalUser(id: string): Promise<LocalUser | null> {
  const db = await openDB();
  const tx = db.transaction(USERS_STORE, 'readonly');
  const request = tx.objectStore(USERS_STORE).get(id);
  const result = await new Promise<LocalUser | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function deleteLocalUser(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(USERS_STORE, 'readwrite');
  tx.objectStore(USERS_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: USERS_STORE, key: id, type: 'delete' });
}

/**
 * The currently-active user's id, or null when nothing has bootstrapped yet.
 * Read synchronously — this is called from the settings hook during app
 * startup, before any async work has finished.
 */
export function getActiveUserId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_USER_KEY);
  } catch {
    return null;
  }
}

export function setActiveUserId(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_USER_KEY, id);
  } catch {
    // Private browsing / storage disabled — the user just gets the default
    // seed user for every session. Not ideal, but not fatal.
  }
  // The active user changing invalidates every user-scoped `useAsyncSnapshot`
  // reader; a synthetic garage-event with the users store forces every hook to
  // refetch under the new scope. See garageEvents.ts.
  emitGarageChange({ store: USERS_STORE, key: id, type: 'put' });
}

/**
 * Fallback resolver used by scoped-storage modules. Returns the active user id
 * if set, else the default seed id — this makes read/write calls safe during
 * the sliver of startup before `useSettings` has run.
 */
export function activeUserIdOrDefault(): string {
  return getActiveUserId() ?? DEFAULT_USER_ID;
}

/**
 * Idempotent app-startup bootstrap: guarantees a "Me" seed user exists (in
 * case the v14 migration skipped it on a fresh install, or the DB was cleared
 * from under us), and sets it as the active user if none is picked yet. Safe
 * to call on every mount.
 */
export async function ensureDefaultUser(): Promise<LocalUser> {
  const existing = await getLocalUser(DEFAULT_USER_ID);
  if (existing) {
    if (!getActiveUserId()) setActiveUserId(existing.id);
    return existing;
  }
  const seed: LocalUser = {
    id: DEFAULT_USER_ID,
    name: DEFAULT_USER_NAME,
    createdAt: Date.now(),
  };
  await saveLocalUser(seed);
  if (!getActiveUserId()) setActiveUserId(seed.id);
  return seed;
}

/** Per-store counts of rows owned by a user — feeds the delete-confirm dialog. */
export type UserRowCounts = Record<string, number>;

/**
 * Count rows in every user-scoped store owned by `userId`. Best-effort:
 * per-store failures are logged and treated as 0.
 */
export async function countUserRows(userId: string): Promise<UserRowCounts> {
  const counts: UserRowCounts = {};
  const db = await openDB();
  try {
    for (const storeName of USER_SCOPED_STORES) {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const all = await new Promise<Array<{ userId?: string }>>((resolve, reject) => {
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        counts[storeName] = all.filter((row) => row.userId === userId).length;
      } catch (e) {
        console.warn(`countUserRows: ${storeName} failed`, e);
        counts[storeName] = 0;
      }
    }
  } finally {
    db.close();
  }
  return counts;
}

/**
 * Delete every row in every user-scoped store owned by `userId`. NOT
 * transactional across stores — IDB won't do that — so a per-store failure is
 * logged and the sweep continues. The `users` row itself is NOT deleted here;
 * caller (`useLocalUsers.removeUser`) does that after switching active user.
 */
export async function cascadeDeleteUser(userId: string): Promise<void> {
  if (userId === DEFAULT_USER_ID) {
    throw new Error('The default user cannot be cascade-deleted.');
  }
  const db = await openDB();
  try {
    for (const storeName of USER_SCOPED_STORES) {
      try {
        // Two txns per store: read all keys owned by this user, then delete.
        // A single readwrite cursor would work but batching the delete list is
        // simpler and keeps the tx short.
        const keys: IDBValidKey[] = await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const rowsReq = store.getAll();
          const keysReq = store.getAllKeys();
          Promise.all([
            new Promise<Array<{ userId?: string }>>((r, j) => { rowsReq.onsuccess = () => r(rowsReq.result); rowsReq.onerror = () => j(rowsReq.error); }),
            new Promise<IDBValidKey[]>((r, j) => { keysReq.onsuccess = () => r(keysReq.result); keysReq.onerror = () => j(keysReq.error); }),
          ])
            .then(([rows, allKeys]) => {
              resolve(allKeys.filter((_, i) => rows[i]?.userId === userId));
            })
            .catch(reject);
        });
        if (keys.length === 0) continue;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          for (const k of keys) store.delete(k);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        // Emit garage events so any open reader refetches. One event per store
        // is enough — every scoped hook is subscribed to its store.
        emitGarageChange({ store: storeName, key: '__cascade__', type: 'delete' });
      } catch (e) {
        console.warn(`cascadeDeleteUser: ${storeName} failed`, e);
      }
    }
  } finally {
    db.close();
  }
}
