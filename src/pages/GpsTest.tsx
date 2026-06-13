/**
 * GPS Test / phone-as-datalogger demo — a STANDALONE page at `/gps-test`.
 *
 * Deliberately decoupled from the rest of the app (no SessionContext, no garage,
 * no parsers): it's a scratch surface to prove the browser Geolocation API can
 * feed a lap-timing library when the phone is the logger. It shows the live
 * position on a Leaflet map plus every field the API exposes, and derives the
 * things the API won't give us (sample rate in Hz, and speed/heading when the
 * device reports null) via the pure `lib/gpsTestMetrics` helpers.
 *
 * High-accuracy, never-cached: `enableHighAccuracy: true` (precise API, not the
 * coarse network estimate) and `maximumAge: 0` (every fix is fresh — the OS may
 * never hand us a stale cached position).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  deriveFix,
  averageHz,
  bestSpeedMps,
  bestHeading,
  toTimingSample,
  type GeoFix,
  type DerivedFix,
  type TimingSample,
} from '@/lib/gpsTestMetrics';

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true, // precise GNSS, not coarse network/wifi positioning
  maximumAge: 0, // never accept a cached fix — we want fresh samples only
  timeout: 30000,
};

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported' | 'unknown';

interface CapturedFix {
  fix: GeoFix;
  derived: DerivedFix;
  sample: TimingSample;
}

function fmt(n: number | null | undefined, digits = 6): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function geoErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Permission denied — allow location access for this site and reload.';
    case err.POSITION_UNAVAILABLE:
      return 'Position unavailable — no GNSS fix yet (move outdoors / wait).';
    case err.TIMEOUT:
      return 'Timed out waiting for a fix.';
    default:
      return err.message || 'Unknown geolocation error.';
  }
}

export default function GpsTest() {
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<CapturedFix[]>([]);

  const watchIdRef = useRef<number | null>(null);
  const startTRef = useRef<number | null>(null);
  // Mirror of captured fixes for the geolocation callback (avoids re-subscribing
  // the watch on every state update just to read the previous fix).
  const fixesRef = useRef<GeoFix[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const followRef = useRef(true);

  // --- Leaflet init -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([0, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 22, // request the deepest tiles for trackside detail
    }).addTo(map);
    trailRef.current = L.polyline([], { color: '#38bdf8', weight: 3, opacity: 0.8 }).addTo(map);
    accuracyRef.current = L.circle([0, 0], { radius: 0, color: '#22c55e', weight: 1, fillOpacity: 0.08 }).addTo(map);
    markerRef.current = L.circleMarker([0, 0], {
      radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1,
    }).addTo(map);
    // A user drag means "stop auto-centering" so they can inspect the trail.
    map.on('dragstart', () => { followRef.current = false; });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // --- Permissions state (best-effort; not all browsers support the query) -
  useEffect(() => {
    if (!('geolocation' in navigator)) { setPermission('unsupported'); return; }
    if (!('permissions' in navigator)) { setPermission('unknown'); return; }
    let status: PermissionStatus | null = null;
    const onChange = () => { if (status) setPermission(status.state as PermissionState); };
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => { status = s; setPermission(s.state as PermissionState); s.addEventListener('change', onChange); })
      .catch(() => setPermission('unknown'));
    return () => { status?.removeEventListener('change', onChange); };
  }, []);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    setError(null);
    const c = pos.coords;
    const fix: GeoFix = {
      t: pos.timestamp,
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy,
      altitude: c.altitude,
      altitudeAccuracy: c.altitudeAccuracy,
      heading: c.heading,
      speed: c.speed,
    };
    const prev = fixesRef.current[fixesRef.current.length - 1] ?? null;
    const derived = deriveFix(prev, fix);
    if (startTRef.current == null) startTRef.current = fix.t;
    const sample = toTimingSample(fix, derived, startTRef.current);
    fixesRef.current = [...fixesRef.current, fix];
    setCaptured((prevCap) => [...prevCap, { fix, derived, sample }]);

    // --- Map update ---
    const latlng: L.LatLngExpression = [fix.lat, fix.lon];
    markerRef.current?.setLatLng(latlng);
    accuracyRef.current?.setLatLng(latlng).setRadius(fix.accuracy);
    trailRef.current?.addLatLng(latlng);
    if (mapRef.current && followRef.current) {
      mapRef.current.setView(latlng, Math.max(mapRef.current.getZoom(), 17), { animate: true });
    }
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    setError(geoErrorMessage(err));
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) { setPermission('unsupported'); return; }
    if (watchIdRef.current != null) return;
    setError(null);
    followRef.current = true;
    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, GEO_OPTIONS);
    setWatching(true);
  }, [handlePosition, handleError]);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  }, []);

  const clear = useCallback(() => {
    fixesRef.current = [];
    startTRef.current = null;
    setCaptured([]);
    trailRef.current?.setLatLngs([]);
    followRef.current = true;
  }, []);

  // Stop the watch on unmount.
  useEffect(() => () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current); }, []);

  const downloadJson = useCallback(() => {
    const payload = {
      capturedAt: new Date().toISOString(),
      count: captured.length,
      averageHz: averageHz(fixesRef.current, fixesRef.current.length),
      // The timing-library feed: GpsSample-shaped rows.
      samples: captured.map((c) => c.sample),
      // Raw fixes for debugging / reprocessing.
      rawFixes: captured.map((c) => c.fix),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gps-test-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [captured]);

  const latest = captured[captured.length - 1] ?? null;
  const avgHz = useMemo(() => averageHz(captured.map((c) => c.fix), 20), [captured]);
  const durationSec = useMemo(() => {
    if (captured.length < 2) return 0;
    return (captured[captured.length - 1].fix.t - captured[0].fix.t) / 1000;
  }, [captured]);

  const secure = window.isSecureContext;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 space-y-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">GPS Test — phone as datalogger</h1>
          <p className="text-sm text-muted-foreground">
            High-accuracy, never-cached geolocation feed for lap timing. Standalone demo.
          </p>
        </div>
        <Link to="/" className="text-sm text-primary underline">← Back to app</Link>
      </header>

      {!secure && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Not a secure context — geolocation requires HTTPS (or localhost). Fixes will fail.
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={watching ? stop : start}
          className={`px-4 py-2 rounded font-medium text-sm ${watching ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}
        >
          {watching ? 'Stop' : 'Start GPS'}
        </button>
        <button onClick={clear} className="px-4 py-2 rounded text-sm bg-secondary text-secondary-foreground">
          Clear
        </button>
        <button
          onClick={downloadJson}
          disabled={captured.length === 0}
          className="px-4 py-2 rounded text-sm bg-secondary text-secondary-foreground disabled:opacity-50"
        >
          Download JSON ({captured.length})
        </button>
        <span className="text-sm text-muted-foreground">
          Permission: <span className="font-mono">{permission}</span>
        </span>
        {watching && <span className="text-sm text-green-500">● watching</span>}
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div ref={containerRef} className="w-full h-[45vh] rounded overflow-hidden border border-border" />

      {/* Rate / timing-feed panel — the stuff the API does NOT give us. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Samples" value={String(captured.length)} />
        <Stat label="Avg rate (20)" value={avgHz != null ? `${avgHz.toFixed(2)} Hz` : '—'} />
        <Stat label="Instant rate" value={latest?.derived.instantHz != null ? `${latest.derived.instantHz.toFixed(2)} Hz` : '—'} />
        <Stat label="Duration" value={`${durationSec.toFixed(1)} s`} />
      </div>

      {/* Every field the Geolocation API exposes, live. */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Raw Geolocation fix (chrome API)">
          <Field name="timestamp" value={latest ? `${latest.fix.t} (${new Date(latest.fix.t).toLocaleTimeString()})` : '—'} />
          <Field name="coords.latitude" value={fmt(latest?.fix.lat, 7)} />
          <Field name="coords.longitude" value={fmt(latest?.fix.lon, 7)} />
          <Field name="coords.accuracy (m)" value={fmt(latest?.fix.accuracy, 2)} />
          <Field name="coords.altitude (m)" value={fmt(latest?.fix.altitude, 2)} />
          <Field name="coords.altitudeAccuracy (m)" value={fmt(latest?.fix.altitudeAccuracy, 2)} />
          <Field name="coords.heading (°)" value={fmt(latest?.fix.heading, 2)} />
          <Field name="coords.speed (m/s)" value={fmt(latest?.fix.speed, 3)} />
        </Card>

        <Card title="Derived / timing-library feed">
          <Field name="t (ms since start)" value={latest ? String(latest.sample.t) : '—'} />
          <Field name="Δt from prev (s)" value={fmt(latest?.derived.dtSec, 3)} />
          <Field name="distance from prev (m)" value={fmt(latest?.derived.distanceM, 2)} />
          <Field
            name="speed (m/s)"
            value={latest ? `${fmt(bestSpeedMps(latest.fix, latest.derived), 3)} (${latest.fix.speed != null ? 'device' : 'derived'})` : '—'}
          />
          <Field name="speed (mph)" value={fmt(latest?.sample.speedMph, 1)} />
          <Field name="speed (kph)" value={fmt(latest?.sample.speedKph, 1)} />
          <Field
            name="heading (°)"
            value={latest ? `${fmt(bestHeading(latest.fix, latest.derived), 1)} (${latest.fix.heading != null ? 'device' : 'derived'})` : '—'}
          />
          <Field name="derived heading (°)" value={fmt(latest?.derived.derivedHeading, 1)} />
        </Card>
      </section>

      <p className="text-xs text-muted-foreground">
        Options: <span className="font-mono">enableHighAccuracy: true</span>,{' '}
        <span className="font-mono">maximumAge: 0</span> (no cache),{' '}
        <span className="font-mono">timeout: 30000</span>. Rate is computed client-side from fix
        timestamps — the API does not report a Hz.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-mono font-semibold">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-card p-3 space-y-1">
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Field({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm border-b border-border/40 py-1 last:border-0">
      <span className="text-muted-foreground font-mono">{name}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
