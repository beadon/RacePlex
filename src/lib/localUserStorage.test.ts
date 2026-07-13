/**
 * Local users (plan 0011). Focus tests: seed bootstrap, cascade delete, and
 * row counts. Uses fake-indexeddb; we open the raceplex DB ourselves to seed
 * scoped rows across stores.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import { openDB, STORE_NAMES } from "./dbUtils";
import {
  cascadeDeleteUser,
  countUserRows,
  DEFAULT_USER_ID,
  DEFAULT_USER_NAME,
  ensureDefaultUser,
  getActiveUserId,
  getLocalUser,
  listLocalUsers,
  saveLocalUser,
  setActiveUserId,
} from "./localUserStorage";

class MemStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

beforeEach(() => {
  freshIndexedDB();
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemStorage();
});

async function putRaw(storeName: string, record: Record<string, unknown>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("ensureDefaultUser", () => {
  it("creates the seed user and sets it active when none exist", async () => {
    const seed = await ensureDefaultUser();
    expect(seed.id).toBe(DEFAULT_USER_ID);
    expect(seed.name).toBe(DEFAULT_USER_NAME);
    expect(getActiveUserId()).toBe(DEFAULT_USER_ID);
  });

  it("is idempotent — a second call is a no-op", async () => {
    await ensureDefaultUser();
    const users1 = await listLocalUsers();
    await ensureDefaultUser();
    const users2 = await listLocalUsers();
    expect(users2).toHaveLength(users1.length);
  });

  it("preserves an already-set active user", async () => {
    await ensureDefaultUser();
    const alice = { id: "alice", name: "Alice", createdAt: 100 };
    await saveLocalUser(alice);
    setActiveUserId(alice.id);
    await ensureDefaultUser(); // called again on every mount
    expect(getActiveUserId()).toBe(alice.id);
  });
});

describe("countUserRows", () => {
  it("returns zero counts for a user with no data", async () => {
    await ensureDefaultUser();
    const alice = { id: "alice", name: "Alice", createdAt: 100 };
    await saveLocalUser(alice);
    const counts = await countUserRows(alice.id);
    // Every user-scoped store present with 0
    expect(counts[STORE_NAMES.FILES]).toBe(0);
    expect(counts[STORE_NAMES.KARTS]).toBe(0);
  });

  it("counts only rows owned by the given user", async () => {
    await ensureDefaultUser();
    const alice = { id: "alice", name: "Alice", createdAt: 100 };
    const bob = { id: "bob", name: "Bob", createdAt: 100 };
    await saveLocalUser(alice);
    await saveLocalUser(bob);
    await putRaw(STORE_NAMES.KARTS, { id: "v1", name: "Alice board", userId: alice.id });
    await putRaw(STORE_NAMES.KARTS, { id: "v2", name: "Bob board", userId: bob.id });
    await putRaw(STORE_NAMES.ENGINES, { id: "e1", name: "Focbox", createdAt: 100, userId: alice.id });

    const aliceCounts = await countUserRows(alice.id);
    const bobCounts = await countUserRows(bob.id);
    expect(aliceCounts[STORE_NAMES.KARTS]).toBe(1);
    expect(aliceCounts[STORE_NAMES.ENGINES]).toBe(1);
    expect(bobCounts[STORE_NAMES.KARTS]).toBe(1);
    expect(bobCounts[STORE_NAMES.ENGINES]).toBe(0);
  });
});

describe("cascadeDeleteUser", () => {
  it("removes every scoped row for the deleted user, leaves others alone", async () => {
    await ensureDefaultUser();
    const alice = { id: "alice", name: "Alice", createdAt: 100 };
    const bob = { id: "bob", name: "Bob", createdAt: 100 };
    await saveLocalUser(alice);
    await saveLocalUser(bob);
    // Two vehicles per user, one engine per user.
    await putRaw(STORE_NAMES.KARTS, { id: "va1", name: "Alice #1", userId: alice.id });
    await putRaw(STORE_NAMES.KARTS, { id: "va2", name: "Alice #2", userId: alice.id });
    await putRaw(STORE_NAMES.KARTS, { id: "vb1", name: "Bob #1", userId: bob.id });
    await putRaw(STORE_NAMES.ENGINES, { id: "ea", name: "Alice Focbox", createdAt: 100, userId: alice.id });
    await putRaw(STORE_NAMES.ENGINES, { id: "eb", name: "Bob Focbox", createdAt: 100, userId: bob.id });

    await cascadeDeleteUser(alice.id);

    const aliceCounts = await countUserRows(alice.id);
    const bobCounts = await countUserRows(bob.id);
    expect(aliceCounts[STORE_NAMES.KARTS]).toBe(0);
    expect(aliceCounts[STORE_NAMES.ENGINES]).toBe(0);
    expect(bobCounts[STORE_NAMES.KARTS]).toBe(1);
    expect(bobCounts[STORE_NAMES.ENGINES]).toBe(1);
  });

  it("refuses to cascade-delete the default user", async () => {
    await ensureDefaultUser();
    await expect(cascadeDeleteUser(DEFAULT_USER_ID)).rejects.toThrow();
  });

  it("leaves the users row itself intact — that's the caller's job", async () => {
    await ensureDefaultUser();
    const alice = { id: "alice", name: "Alice", createdAt: 100 };
    await saveLocalUser(alice);
    await putRaw(STORE_NAMES.KARTS, { id: "va1", userId: alice.id });
    await cascadeDeleteUser(alice.id);
    // The user record itself remains — useLocalUsers.removeUser deletes it
    // separately after switching the active user.
    expect(await getLocalUser(alice.id)).not.toBeNull();
  });
});
