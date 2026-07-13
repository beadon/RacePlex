import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GpsSample, Lap } from "@/types/racing";

interface ComparisonMapSession {
  fileName: string;
  samples: GpsSample[];
  lap: Lap | null;
}

interface ComparisonMapProps {
  sessions: readonly ComparisonMapSession[];
  colourFor: (fileName: string) => string;
}

/**
 * Small shared map for the /compare route (plan 0012, slice 6): one
 * polyline per session's selected lap, drawn in the same colour that
 * session gets in the charts underneath.
 *
 * Deliberately basic — no tiles UI, no playback cursor, no drift alignment
 * (the charts compare by cumulative distance, which is invariant under a
 * rigid transform, so mis-aligned lat/lon here doesn't distort the
 * numbers). Riders who need the full map treatment open a session solo.
 */
export function ComparisonMap({ sessions, colourFor }: ComparisonMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylinesRef = useRef<L.Polyline[]>([]);

  // The polyline set to draw. Only sessions with a selected lap + real
  // samples make the cut. `useMemo` gates the render effect below.
  const drawSet = useMemo(() => {
    return sessions
      .filter((s): s is ComparisonMapSession & { lap: Lap } => !!s.lap)
      .map((s) => {
        const start = s.lap.startIndex;
        const end = s.lap.endIndex;
        const lapSamples = s.samples.slice(Math.max(0, start), Math.min(s.samples.length, end + 1));
        return {
          fileName: s.fileName,
          latlngs: lapSamples.map((p) => [p.lat, p.lon] as [number, number]),
        };
      })
      .filter((s) => s.latlngs.length >= 2);
  }, [sessions]);

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
    }).setView([0, 0], 16);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; CARTO",
      maxZoom: 20,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      polylinesRef.current = [];
    };
  }, []);

  // Redraw the polylines when the drawSet changes. Cheap: at most a
  // handful of sessions, each ~a few hundred points on a fastest lap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear the previous set.
    for (const line of polylinesRef.current) line.remove();
    polylinesRef.current = [];

    if (drawSet.length === 0) return;

    const bounds = L.latLngBounds([]);
    for (const s of drawSet) {
      const line = L.polyline(s.latlngs, {
        color: colourFor(s.fileName),
        weight: 3,
        opacity: 0.85,
        smoothFactor: 1,
      }).addTo(map);
      polylinesRef.current.push(line);
      for (const p of s.latlngs) bounds.extend(p);
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
    }
  }, [drawSet, colourFor]);

  return (
    <div className="rounded-md border border-border overflow-hidden bg-card" style={{ height: 320 }}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
