import { useCallback } from "react";
import { Vehicle, listVehicles, saveVehicle, deleteVehicle } from "@/lib/vehicleStorage";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const INITIAL: Vehicle[] = [];

// vehicleStorage emits under STORE_NAMES.KARTS (the IDB name stayed put when
// the domain renamed from Kart → Vehicle). Filter to that store so unrelated
// garage mutations don't trip a refetch.
function subscribeToVehicles(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.KARTS) onChange();
  });
}

export function useVehicleManager() {
  const { data: vehicles, refresh } = useAsyncSnapshot({
    key: "garage:vehicles",
    initial: INITIAL,
    load: listVehicles,
    subscribe: subscribeToVehicles,
  });

  const addVehicle = useCallback(async (vehicle: Omit<Vehicle, "id">) => {
    const newVehicle: Vehicle = { ...vehicle, id: crypto.randomUUID() };
    await saveVehicle(newVehicle);
  }, []);

  const updateVehicle = useCallback(async (vehicle: Vehicle) => {
    await saveVehicle(vehicle);
  }, []);

  const removeVehicle = useCallback(async (id: string) => {
    await deleteVehicle(id);
  }, []);

  return { vehicles, refresh, addVehicle, updateVehicle, removeVehicle };
}

// Backward compat
export const useKartManager = useVehicleManager;
