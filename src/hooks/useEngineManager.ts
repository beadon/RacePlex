import { useCallback } from "react";
import { Engine, listEngines, saveEngine, deleteEngine } from "@/lib/engineStorage";
import { distinctEngineNames, findEngineByName, normalizeEngineName } from "@/lib/engineUtils";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const INITIAL: Engine[] = [];

// engineStorage writes emit a garage change on STORE_NAMES.ENGINES; this
// subscribe filter fires the refetch on every such event, so callers don't
// have to manually refresh() after mutations.
function subscribeToEngines(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.ENGINES) onChange();
  });
}

export function useEngineManager() {
  const { data: engines, refresh } = useAsyncSnapshot({
    key: "garage:engines",
    initial: INITIAL,
    load: listEngines,
    subscribe: subscribeToEngines,
  });

  /** Create an engine by name (deduped, case-insensitive). Returns the engine name. */
  const addEngine = useCallback(
    async (name: string): Promise<string | null> => {
      const display = normalizeEngineName(name);
      if (!display) return null;
      const existing = findEngineByName(engines, display);
      if (existing) return existing.name;
      await saveEngine({ id: crypto.randomUUID(), name: display, createdAt: Date.now() });
      return display;
    },
    [engines],
  );

  /** Ensure every supplied name exists in the list (used to seed from existing vehicles). */
  const importEngines = useCallback(
    async (names: string[]) => {
      const current = await listEngines();
      const missing = distinctEngineNames(names).filter((n) => !findEngineByName(current, n));
      if (missing.length === 0) return;
      for (const name of missing) {
        await saveEngine({ id: crypto.randomUUID(), name, createdAt: Date.now() });
      }
    },
    [],
  );

  const removeEngine = useCallback(
    async (id: string) => {
      await deleteEngine(id);
    },
    [],
  );

  return { engines, refresh, addEngine, importEngines, removeEngine };
}
