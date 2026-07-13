import { useCallback, useState } from 'react';
import { fetchWaybackReleases, type WaybackRelease } from '@/lib/satelliteImagery';
import { useAsyncSnapshot } from './useAsyncSnapshot';

export interface UseWaybackImagery {
  releases: WaybackRelease[];
  loading: boolean;
  error: boolean;
  /** Trigger the (one-time) fetch — called when the imagery-date picker opens. */
  load: () => void;
}

interface Snapshot {
  releases: WaybackRelease[];
  error: boolean;
  loaded: boolean;
}

const EMPTY: Snapshot = { releases: [], error: false, loaded: false };

const loader = async (): Promise<Snapshot> => {
  try {
    const releases = await fetchWaybackReleases();
    return { releases, error: false, loaded: true };
  } catch {
    return { releases: [], error: true, loaded: true };
  }
};

const noop = async (): Promise<Snapshot> => EMPTY;

/**
 * Lazily loads the Esri Wayback release list the first time `load()` is called
 * (i.e. when the user actually reaches for the satellite imagery-date picker),
 * so the config fetch stays off the initial path and never runs for offline
 * users who only use the default imagery. The underlying fetch is memoised in
 * `satelliteImagery.ts`, so multiple maps share one request.
 */
export function useWaybackImagery(): UseWaybackImagery {
  const [requested, setRequested] = useState(false);
  const load = useCallback(() => setRequested(true), []);

  // Two cache keys: the "unrequested" one always resolves to the empty
  // snapshot (no network), and the "requested" one fires the real fetch. This
  // preserves the deferred-until-opened behavior while satisfying React 19's
  // useSyncExternalStore contract.
  const { data } = useAsyncSnapshot({
    key: requested ? 'wayback:releases' : 'wayback:idle',
    initial: EMPTY,
    load: requested ? loader : noop,
  });

  return {
    releases: data.releases,
    loading: requested && !data.loaded,
    error: data.error,
    load,
  };
}
