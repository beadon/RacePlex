import { useCallback, useEffect, useState } from 'react';
import { fetchWaybackReleases, type WaybackRelease } from '@/lib/satelliteImagery';

export interface UseWaybackImagery {
  releases: WaybackRelease[];
  loading: boolean;
  error: boolean;
  /** Trigger the (one-time) fetch — called when the imagery-date picker opens. */
  load: () => void;
}

/**
 * Lazily loads the Esri Wayback release list the first time `load()` is called
 * (i.e. when the user actually reaches for the satellite imagery-date picker),
 * so the config fetch stays off the initial path and never runs for offline
 * users who only use the default imagery. The underlying fetch is memoised in
 * `satelliteImagery.ts`, so multiple maps share one request.
 */
export function useWaybackImagery(): UseWaybackImagery {
  const [releases, setReleases] = useState<WaybackRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [requested, setRequested] = useState(false);

  const load = useCallback(() => setRequested(true), []);

  useEffect(() => {
    if (!requested || releases.length > 0 || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchWaybackReleases()
      .then((r) => { if (!cancelled) setReleases(r); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requested, releases.length, loading]);

  return { releases, loading, error, load };
}
