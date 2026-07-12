import { useCallback, useEffect } from "react";
import { VehicleSetup, listSetups, saveSetup, deleteSetup, getLatestSetupForVehicle } from "@/lib/setupStorage";
import { maybePruneSetupRevisions } from "@/lib/setupRevisionStorage";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const INITIAL: VehicleSetup[] = [];

function subscribeToSetups(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.SETUPS) onChange();
  });
}

export function useSetupManager() {
  const { data: setups } = useAsyncSnapshot({
    key: "garage:setups",
    initial: INITIAL,
    load: listSetups,
    subscribe: subscribeToSetups,
  });

  // Throttled (~3-day) sweep of setup revisions no session references. Fire-
  // and-forget — never blocks the garage UI, no-ops until the interval elapses.
  useEffect(() => {
    void maybePruneSetupRevisions();
  }, []);

  const addSetup = useCallback(async (setup: Omit<VehicleSetup, "id" | "createdAt" | "updatedAt">) => {
    const now = Date.now();
    const full: VehicleSetup = {
      ...setup,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await saveSetup(full);
  }, []);

  const updateSetup = useCallback(async (setup: VehicleSetup) => {
    await saveSetup({ ...setup, updatedAt: Date.now() });
  }, []);

  const removeSetup = useCallback(async (id: string) => {
    await deleteSetup(id);
  }, []);

  const getLatestForVehicle = useCallback(async (vehicleId: string) => {
    return getLatestSetupForVehicle(vehicleId);
  }, []);

  // Backward compat alias
  const getLatestForKart = getLatestForVehicle;

  return { setups, addSetup, updateSetup, removeSetup, getLatestForVehicle, getLatestForKart };
}
