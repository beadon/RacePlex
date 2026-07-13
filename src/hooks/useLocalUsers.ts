import { useCallback, useEffect, useState } from "react";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import {
  DEFAULT_USER_ID,
  DEFAULT_USER_NAME,
  deleteLocalUser,
  ensureDefaultUser,
  getActiveUserId,
  listLocalUsers,
  saveLocalUser,
  setActiveUserId,
  type LocalUser,
} from "@/lib/localUserStorage";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const EMPTY: LocalUser[] = [];

function subscribeToUsers(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.USERS) onChange();
  });
}

/**
 * React adapter over the users store + active-user pointer. Guarantees a "Me"
 * seed user exists (idempotent bootstrap on mount), exposes the list, the
 * currently-active id, and the CRUD verbs. Switching the active user emits a
 * synthetic garage event on the USERS store so every user-scoped
 * `useAsyncSnapshot` (files, garage, snapshots, …) refetches under the new
 * scope automatically.
 */
export function useLocalUsers() {
  const { data: users, refresh } = useAsyncSnapshot({
    key: "users:list",
    initial: EMPTY,
    load: listLocalUsers,
    subscribe: subscribeToUsers,
  });

  // Track the active user in local component state, but keep it in sync with
  // localStorage via the same garage-event pub/sub — an active-user switch
  // emits USERS, so every hook re-reads without any manual wiring.
  const [activeUserId, setActive] = useState<string | null>(() => getActiveUserId());

  useEffect(() => {
    // Bootstrap: guarantee the seed user + an active-user pointer on first
    // mount. If the async ensure creates a new seed, its garage-event
    // subscription below will pull the fresh list; state stays in sync.
    void ensureDefaultUser().then((u) => {
      setActive(getActiveUserId() ?? u.id);
    });
    return onGarageChange((c) => {
      if (c.store !== STORE_NAMES.USERS) return;
      setActive(getActiveUserId());
    });
  }, []);

  const switchUser = useCallback((id: string) => {
    setActiveUserId(id);
    setActive(id);
  }, []);

  const createUser = useCallback(async (name: string): Promise<LocalUser | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const user: LocalUser = {
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: Date.now(),
    };
    await saveLocalUser(user);
    return user;
  }, []);

  const renameUser = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existing = users.find((u) => u.id === id);
      if (!existing) return;
      await saveLocalUser({ ...existing, name: trimmed });
    },
    [users],
  );

  /**
   * Delete a user AND every scoped row that belongs to them. Not
   * transactional across stores (IDB won't do that) — a per-store failure
   * is logged and the rest continue.
   */
  const removeUser = useCallback(
    async (id: string) => {
      if (id === DEFAULT_USER_ID) {
        // Leave the seed user in place so there's always a "Me" fallback for
        // a fresh boot on a shared machine; renaming it is fine.
        throw new Error("The default user can't be deleted (rename it instead).");
      }
      const { cascadeDeleteUser } = await import("@/lib/localUserStorage");
      await cascadeDeleteUser(id);
      if (activeUserId === id) {
        // Fell back to the default user; every scoped hook will refetch on
        // the USERS garage-event that `setActiveUserId` emits.
        setActiveUserId(DEFAULT_USER_ID);
        setActive(DEFAULT_USER_ID);
      }
      await deleteLocalUser(id);
    },
    [activeUserId],
  );

  return {
    users,
    activeUserId,
    activeUser: users.find((u) => u.id === activeUserId) ?? null,
    defaultUserId: DEFAULT_USER_ID,
    defaultUserName: DEFAULT_USER_NAME,
    switchUser,
    createUser,
    renameUser,
    removeUser,
    refresh,
  };
}
