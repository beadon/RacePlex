import { Car, Wrench } from "lucide-react";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { listVehicles } from "@/lib/vehicleStorage";
import { listSetups } from "@/lib/setupStorage";
import { useAsyncSnapshot } from "@/hooks/useAsyncSnapshot";

interface GarageTileProps {
  /** Open the garage drawer on its Vehicles tab. */
  onManage: () => void;
}

interface GarageSnapshot {
  vehicles: number;
  setups: number;
  loaded: boolean;
}

const EMPTY: GarageSnapshot = { vehicles: 0, setups: 0, loaded: false };

async function loadGarage(): Promise<GarageSnapshot> {
  const [v, s] = await Promise.all([listVehicles(), listSetups()]);
  return { vehicles: v.length, setups: s.length, loaded: true };
}

function subscribeGarage(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.KARTS || c.store === STORE_NAMES.SETUPS) onChange();
  });
}

/** Concise pair of counts + a "Manage" link into the garage drawer. */
export function GarageTile({ onManage }: GarageTileProps) {
  const { data } = useAsyncSnapshot({
    key: "dashboard:garage",
    initial: EMPTY,
    load: loadGarage,
    subscribe: subscribeGarage,
  });

  return (
    <button
      type="button"
      onClick={onManage}
      className="text-left rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between hover:bg-muted/50 hover:border-primary/40 transition-colors"
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Car className="w-4 h-4 text-primary" />
          Garage
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.loaded
            ? "Vehicles and their setups. Click to manage."
            : "Loading…"}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Vehicles</dt>
          <dd className="text-xl font-semibold text-foreground tabular-nums">
            {data.loaded ? data.vehicles : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            Setups
          </dt>
          <dd className="text-xl font-semibold text-foreground tabular-nums">
            {data.loaded ? data.setups : "—"}
          </dd>
        </div>
      </dl>
    </button>
  );
}
