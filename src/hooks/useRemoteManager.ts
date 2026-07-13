import { useCallback } from "react";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { deleteRemote, listRemotes, saveRemote, type Remote } from "@/lib/remoteStorage";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const EMPTY: Remote[] = [];

function subscribeToRemotes(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.REMOTES || c.store === STORE_NAMES.USERS) onChange();
  });
}

/** React adapter over the remotes store (plan 0010). */
export function useRemoteManager() {
  const { data: remotes, refresh } = useAsyncSnapshot({
    key: "garage:remotes",
    initial: EMPTY,
    load: listRemotes,
    subscribe: subscribeToRemotes,
  });

  const addRemote = useCallback(async (input: Omit<Remote, "id" | "createdAt">): Promise<Remote> => {
    const remote: Remote = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...input,
    };
    await saveRemote(remote);
    return remote;
  }, []);

  const updateRemote = useCallback(
    async (id: string, patch: Partial<Omit<Remote, "id" | "createdAt">>) => {
      const current = remotes.find((r) => r.id === id);
      if (!current) return;
      await saveRemote({ ...current, ...patch });
    },
    [remotes],
  );

  const removeRemote = useCallback(async (id: string) => {
    await deleteRemote(id);
  }, []);

  return { remotes, refresh, addRemote, updateRemote, removeRemote };
}
