import { Gauge, Trophy } from "lucide-react";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { listAllMetadata, type FileMetadata } from "@/lib/fileStorage";
import { formatLapTime } from "@/lib/lapCalculation";
import { isSampleFileName } from "@/lib/sampleData";
import { useAsyncSnapshot } from "@/hooks/useAsyncSnapshot";

interface SessionsSummarySnapshot {
  total: number;
  fastestLapMs: number | null;
  fastestSession: string | null;
  loaded: boolean;
}

const EMPTY: SessionsSummarySnapshot = {
  total: 0,
  fastestLapMs: null,
  fastestSession: null,
  loaded: false,
};

async function loadSummary(): Promise<SessionsSummarySnapshot> {
  const all: FileMetadata[] = await listAllMetadata();
  // Exclude the bundled sample so its lap doesn't headline a user's stats.
  // Sessions with no fastestLapMs recorded (very old imports) still count
  // for the total; they just don't participate in the fastest-lap tally.
  const real = all.filter((m) => !m.isSample && !isSampleFileName(m.fileName));
  let fastestLapMs: number | null = null;
  let fastestSession: string | null = null;
  for (const m of real) {
    if (m.fastestLapMs && (fastestLapMs === null || m.fastestLapMs < fastestLapMs)) {
      fastestLapMs = m.fastestLapMs;
      fastestSession = m.displayName ?? m.trackName ?? m.fileName;
    }
  }
  return { total: real.length, fastestLapMs, fastestSession, loaded: true };
}

function subscribe(onChange: () => void): () => void {
  return onGarageChange((c) => {
    if (c.store === STORE_NAMES.METADATA || c.store === STORE_NAMES.FILES) onChange();
  });
}

/**
 * Sessions summary — a peer of GarageTile and TracksTile. Answers "what have
 * I done?" at a glance: how many sessions, and what's the fastest lap across
 * all of them. Excludes the bundled sample so it doesn't headline a real
 * rider's stats.
 */
export function SessionsSummaryTile() {
  const { data } = useAsyncSnapshot({
    key: "dashboard:sessions-summary",
    initial: EMPTY,
    load: loadSummary,
    subscribe,
  });

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          Sessions
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.loaded ? "Everything you've logged on this device." : "Loading…"}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</dt>
          <dd className="text-xl font-semibold text-foreground tabular-nums">
            {data.loaded ? data.total : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Trophy className="w-3 h-3" />
            Fastest lap
          </dt>
          <dd
            className="text-xl font-semibold text-foreground tabular-nums truncate"
            title={data.fastestSession ?? undefined}
          >
            {data.loaded
              ? data.fastestLapMs !== null
                ? formatLapTime(data.fastestLapMs)
                : "—"
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
