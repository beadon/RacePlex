import { useMemo } from "react";
import type { AlignedSeries } from "@/lib/comparison/align";

interface ComparisonChartProps {
  channelId: string;
  series: readonly AlignedSeries[];
  colourFor: (fileName: string) => string;
}

const WIDTH = 900;
const HEIGHT = 220;
const MARGIN = { top: 16, right: 16, bottom: 26, left: 44 };
const INNER_W = WIDTH - MARGIN.left - MARGIN.right;
const INNER_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/**
 * One channel plotted for every session in the comparison, coloured per
 * session. SVG rather than Canvas — the point counts are small (~200 per
 * series × up to 8 series) and SVG hover/tooltips are cheaper to add later.
 * A follow-up slice can swap in the app's `TelemetryChart` if we want the
 * full playback cursor / crosshair story.
 */
export function ComparisonChart({ channelId, series, colourFor }: ComparisonChartProps) {
  const { xMax, yMin, yMax, paths, empty } = useMemo(() => {
    let xMax = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    const validSeries = series.filter((s) => (s.channels[channelId]?.length ?? 0) > 0);
    for (const s of validSeries) {
      xMax = Math.max(xMax, s.totalDistanceM);
      for (const y of s.channels[channelId]) {
        if (!Number.isFinite(y)) continue;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax || xMax <= 0) {
      return { xMax: 0, yMin: 0, yMax: 0, paths: [] as Array<{ fileName: string; d: string }>, empty: true };
    }
    // Pad y range 5% each side so lines don't touch the frame.
    const yPad = (yMax - yMin) * 0.05;
    const y0 = yMin - yPad;
    const y1 = yMax + yPad;

    const paths = validSeries.map((s) => {
      const ys = s.channels[channelId];
      const xs = s.distances;
      const points: string[] = [];
      for (let i = 0; i < xs.length; i++) {
        const y = ys[i];
        if (!Number.isFinite(y)) continue;
        const px = MARGIN.left + (xs[i] / xMax) * INNER_W;
        const py = MARGIN.top + INNER_H - ((y - y0) / (y1 - y0)) * INNER_H;
        points.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`);
      }
      return { fileName: s.fileName, d: points.join(" ") };
    });
    return { xMax, yMin: y0, yMax: y1, paths, empty: false };
  }, [channelId, series]);

  const label = channelDisplayName(channelId);

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-foreground">{label}</div>
      </div>
      {empty ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          No {label} data in the selected laps.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="w-full h-56"
          role="img"
          aria-label={`${label} vs. distance for ${paths.length} sessions`}
        >
          {/* Frame */}
          <rect
            x={MARGIN.left} y={MARGIN.top}
            width={INNER_W} height={INNER_H}
            fill="none" stroke="hsl(var(--border))" strokeWidth={1}
          />
          {/* Y-axis labels — min, max, midpoint. */}
          <text x={MARGIN.left - 6} y={MARGIN.top + 4} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
            {formatY(yMax, channelId)}
          </text>
          <text x={MARGIN.left - 6} y={MARGIN.top + INNER_H} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
            {formatY(yMin, channelId)}
          </text>
          {/* X-axis labels — 0 and xMax */}
          <text x={MARGIN.left} y={HEIGHT - 8} textAnchor="start" fontSize={10} fill="hsl(var(--muted-foreground))">
            0 m
          </text>
          <text x={MARGIN.left + INNER_W} y={HEIGHT - 8} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
            {Math.round(xMax)} m
          </text>
          {/* Series */}
          {paths.map((p) => (
            <path
              key={p.fileName}
              d={p.d}
              fill="none"
              stroke={colourFor(p.fileName)}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.85}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/**
 * Present a channel id in the chart title. `speedMps` gets its own name
 * because it's a first-class field, not an extra-field key. Everything else
 * is just the raw id — a follow-up slice can wire this to `channels.ts`'s
 * `channelLabel()` for prettier names.
 */
function channelDisplayName(id: string): string {
  if (id === "speedMps") return "Speed (m/s)";
  return id;
}

/** Y-value formatter — 1 decimal for speed, rounded for everything else. */
function formatY(v: number, id: string): string {
  if (id === "speedMps") return `${v.toFixed(1)}`;
  return `${v.toFixed(Math.abs(v) < 10 ? 2 : 0)}`;
}
