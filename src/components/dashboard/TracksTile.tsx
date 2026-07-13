import { Map as MapIcon } from "lucide-react";
import { onGarageChange } from "@/lib/garageEvents";
import { loadTracks, TRACKS_SYNC_STORE } from "@/lib/trackStorage";
import { useAsyncSnapshot } from "@/hooks/useAsyncSnapshot";

interface TracksSnapshot {
  count: number;
  loaded: boolean;
}

const EMPTY: TracksSnapshot = { count: 0, loaded: false };

async function loadTracksSummary(): Promise<TracksSnapshot> {
  const tracks = await loadTracks();
  return { count: tracks.length, loaded: true };
}

function subscribeTracks(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === TRACKS_SYNC_STORE) onChange();
  });
}

/**
 * Track collection summary. Meant to be wrapped by TrackEditor's
 * `triggerButton`, so clicking anywhere on the tile opens the full track
 * manager dialog. The wrapper handles the click — that's why this component
 * doesn't render its own button.
 */
export function TracksTile() {
  const { data } = useAsyncSnapshot({
    key: "dashboard:tracks",
    initial: EMPTY,
    load: loadTracksSummary,
    subscribe: subscribeTracks,
  });

  return (
    <div className="text-left rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between hover:bg-muted/50 hover:border-primary/40 transition-colors cursor-pointer">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-primary" />
          Tracks
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.loaded
            ? "Tracks and courses on this device. Click to manage."
            : "Loading…"}
        </p>
      </div>
      <dl className="mt-4">
        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Tracks</dt>
        <dd className="text-xl font-semibold text-foreground tabular-nums">
          {data.loaded ? data.count : "—"}
        </dd>
      </dl>
    </div>
  );
}
