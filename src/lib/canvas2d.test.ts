/**
 * Unit tests for the shared chart canvas helpers: conditional buffer resize
 * (prepare2dCanvas) and series path stroking (strokeSeriesPath).
 */

import { describe, it, expect } from "vitest";
import { prepare2dCanvas, strokeSeriesPath, type Canvas2dLike } from "./canvas2d";
import type { SeriesPoint } from "./chartUtils";

/** Recording stub for the small context surface the helpers touch. */
function makeStubCanvas() {
  const calls: string[] = [];
  const ctx = {
    setTransform: (...args: number[]) => calls.push(`setTransform(${args.join(",")})`),
    beginPath: () => calls.push("beginPath"),
    moveTo: (x: number, y: number) => calls.push(`moveTo(${x},${y})`),
    lineTo: (x: number, y: number) => calls.push(`lineTo(${x},${y})`),
    stroke: () => calls.push("stroke"),
  };
  let widthSets = 0;
  let heightSets = 0;
  const canvas = {
    _width: 0,
    _height: 0,
    get width() { return this._width; },
    set width(v: number) { this._width = v; widthSets++; },
    get height() { return this._height; },
    set height(v: number) { this._height = v; heightSets++; },
    getContext: () => ctx,
  };
  return {
    canvas: canvas as unknown as Canvas2dLike,
    calls,
    counters: { get widthSets() { return widthSets; }, get heightSets() { return heightSets; } },
  };
}

// ─── prepare2dCanvas ────────────────────────────────────────────────────────

describe("prepare2dCanvas", () => {
  it("sizes the buffer to CSS size × dpr and resets the transform", () => {
    const { canvas, calls } = makeStubCanvas();
    const ctx = prepare2dCanvas(canvas, 300, 150, 2);
    expect(ctx).not.toBeNull();
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
    expect(calls).toContain("setTransform(2,0,0,2,0,0)");
  });

  it("does NOT reassign the buffer when the size is unchanged (regression)", () => {
    // Reassigning canvas.width reallocates + clears the buffer; the old charts
    // did it on every draw — including every playback tick.
    const { canvas, counters } = makeStubCanvas();
    prepare2dCanvas(canvas, 300, 150, 2);
    const setsAfterFirst = counters.widthSets + counters.heightSets;
    prepare2dCanvas(canvas, 300, 150, 2);
    prepare2dCanvas(canvas, 300, 150, 2);
    expect(counters.widthSets + counters.heightSets).toBe(setsAfterFirst);
  });

  it("resizes when dimensions or dpr change", () => {
    const { canvas } = makeStubCanvas();
    prepare2dCanvas(canvas, 300, 150, 1);
    expect(canvas.width).toBe(300);
    prepare2dCanvas(canvas, 300, 150, 2);
    expect(canvas.width).toBe(600);
  });

  it("clamps to a 1px minimum buffer", () => {
    const { canvas } = makeStubCanvas();
    prepare2dCanvas(canvas, 0, 0, 1);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });
});

// ─── strokeSeriesPath ───────────────────────────────────────────────────────

describe("strokeSeriesPath", () => {
  const toX = (frac: number) => frac * 100;
  const toY = (value: number) => 100 - value;

  it("moveTo's the first point and lineTo's the rest", () => {
    const { canvas, calls } = makeStubCanvas();
    const ctx = canvas.getContext("2d")!;
    const pts: SeriesPoint[] = [
      { frac: 0, value: 10, gap: false },
      { frac: 0.5, value: 20, gap: false },
      { frac: 1, value: 30, gap: false },
    ];
    strokeSeriesPath(ctx, pts, toX, toY);
    expect(calls).toEqual([
      "beginPath",
      "moveTo(0,90)",
      "lineTo(50,80)",
      "lineTo(100,70)",
      "stroke",
    ]);
  });

  it("breaks the line at gap points", () => {
    const { canvas, calls } = makeStubCanvas();
    const ctx = canvas.getContext("2d")!;
    const pts: SeriesPoint[] = [
      { frac: 0, value: 10, gap: false },
      { frac: 0.5, value: 20, gap: true },
      { frac: 1, value: 30, gap: false },
    ];
    strokeSeriesPath(ctx, pts, toX, toY);
    expect(calls).toEqual([
      "beginPath",
      "moveTo(0,90)",
      "moveTo(50,80)",
      "lineTo(100,70)",
      "stroke",
    ]);
  });

  it("does nothing for an empty series", () => {
    const { canvas, calls } = makeStubCanvas();
    const ctx = canvas.getContext("2d")!;
    strokeSeriesPath(ctx, [], toX, toY);
    expect(calls).toEqual([]);
  });
});
