/**
 * Remotes catalog (plan 0010). First-run seed per user, per-user scoping,
 * CRUD round-trip.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import { REMOTE_CATALOG_SEED } from "./remoteCatalogSeed";
import { deleteRemote, getRemote, listRemotes, saveRemote, type Remote } from "./remoteStorage";
import { ensureDefaultUser, saveLocalUser, setActiveUserId } from "./localUserStorage";

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

describe("listRemotes — first-run seed", () => {
  it("seeds the default user's catalog with every entry from REMOTE_CATALOG_SEED", async () => {
    await ensureDefaultUser();
    const first = await listRemotes();
    expect(first.length).toBe(REMOTE_CATALOG_SEED.length);
    // Second read is a no-op (idempotent seed).
    const second = await listRemotes();
    expect(second.length).toBe(REMOTE_CATALOG_SEED.length);
  });

  it("seeds each user separately — Alice's list is independent of Bob's", async () => {
    await ensureDefaultUser();
    const alice = { id: "alice", name: "Alice", createdAt: 100 };
    const bob = { id: "bob", name: "Bob", createdAt: 100 };
    await saveLocalUser(alice);
    await saveLocalUser(bob);

    setActiveUserId(alice.id);
    const aliceList = await listRemotes();
    expect(aliceList.length).toBe(REMOTE_CATALOG_SEED.length);
    expect(aliceList.every((r) => r.userId === alice.id)).toBe(true);

    setActiveUserId(bob.id);
    const bobList = await listRemotes();
    expect(bobList.length).toBe(REMOTE_CATALOG_SEED.length);
    expect(bobList.every((r) => r.userId === bob.id)).toBe(true);

    // Ids don't collide because seedCatalog prefixes with the user's id.
    const aliceIds = new Set(aliceList.map((r) => r.id));
    const bobIds = new Set(bobList.map((r) => r.id));
    expect([...aliceIds].every((id) => !bobIds.has(id))).toBe(true);
  });
});

describe("CRUD", () => {
  it("round-trips a custom remote", async () => {
    await ensureDefaultUser();
    const remote: Remote = {
      id: crypto.randomUUID(),
      brand: "Custom",
      model: "Prototype",
      radio: "sub-GHz",
      rangeMeters: 500,
      createdAt: Date.now(),
    };
    await saveRemote(remote);
    const fetched = await getRemote(remote.id);
    expect(fetched?.brand).toBe("Custom");
    expect(fetched?.userId).toBe("default-user");
  });

  it("delete removes the row", async () => {
    await ensureDefaultUser();
    const list = await listRemotes();
    const victim = list[0];
    await deleteRemote(victim.id);
    const after = await listRemotes();
    expect(after.find((r) => r.id === victim.id)).toBeUndefined();
  });
});
