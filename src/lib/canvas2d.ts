/**
 * Canvas 2D helpers shared by the telemetry charts (TelemetryChart,
 * SingleSeriesChart, GGDiagram). Structurally typed so they stay unit-testable
 * in the node test environment (no DOM).
 */

import type { SeriesPoint } from './chartUtils';

/** The slice of HTMLCanvasElement the helpers need. */
export interface Canvas2dLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Get a DPR-scaled 2D context, resizing the backing buffer only when the CSS
 * size or device pixel ratio actually changed. Reassigning canvas.width
 * reallocates (and clears) the buffer, so doing it unconditionally on every
 * draw — as the charts used to — pays a full reallocation per playback tick.
 * The transform is reset every call, so callers always draw in CSS pixels.
 * Note this never clears a same-size canvas: static layers repaint their
 * background, cursor layers clearRect.
 */
export function prepare2dCanvas(
  canvas: Canvas2dLike,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** The slice of CanvasRenderingContext2D that path stroking needs. */
export interface StrokePathContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/**
 * Stroke a series as one path: moveTo on the first point and after every gap,
 * lineTo otherwise. Pair with `buildSeriesPoints` (chartUtils) so dense series
 * arrive pre-decimated. Stroke style/width/dash are the caller's business.
 */
export function strokeSeriesPath(
  ctx: StrokePathContext,
  points: ReadonlyArray<SeriesPoint>,
  toX: (frac: number) => number,
  toY: (value: number) => number,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  let drawing = false;
  for (const p of points) {
    const x = toX(p.frac);
    const y = toY(p.value);
    if (!drawing || p.gap) {
      ctx.moveTo(x, y);
      drawing = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}
