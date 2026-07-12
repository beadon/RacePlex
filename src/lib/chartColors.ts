/** Theme-aware color palettes for canvas-drawn charts */

import type { PaletteId } from './palettes';

export interface ChartColorPalette {
  background: string;
  grid: string;
  axisText: string;
  tooltipBg: string;
  tooltipBorder: string;
  scrubCursor: string;
  zeroLine: string;
  refLine: string;
  deltaText: string;
}

const dark: ChartColorPalette = {
  background: 'hsl(220, 18%, 10%)',
  grid: 'hsl(220, 15%, 20%)',
  axisText: 'hsl(220, 10%, 55%)',
  tooltipBg: 'hsla(220, 18%, 10%, 0.9)',
  tooltipBorder: 'hsl(220, 15%, 25%)',
  scrubCursor: 'hsl(0, 75%, 55%)',
  zeroLine: 'hsla(220, 10%, 55%, 0.4)',
  refLine: 'hsla(220, 10%, 55%, 0.5)',
  deltaText: 'hsl(0, 0%, 85%)',
};

const light: ChartColorPalette = {
  background: 'hsl(0, 0%, 100%)',
  grid: 'hsl(220, 15%, 88%)',
  axisText: 'hsl(220, 10%, 40%)',
  tooltipBg: 'hsla(0, 0%, 100%, 0.95)',
  tooltipBorder: 'hsl(220, 15%, 80%)',
  scrubCursor: 'hsl(0, 75%, 50%)',
  zeroLine: 'hsla(220, 10%, 50%, 0.4)',
  refLine: 'hsla(220, 10%, 45%, 0.5)',
  deltaText: 'hsl(220, 10%, 30%)',
};

/**
 * Per-palette chart chrome. The charts paint onto a <canvas>, which can't read the
 * `--card` / `--border` / `--muted-foreground` custom properties the surrounding
 * card is styled from — so each palette in index.css has to be mirrored here or the
 * chart would sit as a mismatched rectangle inside its card (most visibly on the
 * navy `retro` card). These are the *chrome* only; the data series keep their own
 * fixed colors (COLORS in TelemetryChart), which is what keeps them mutually
 * distinguishable no matter which palette is on.
 *
 * `background` mirrors `--card`, `grid` mirrors `--border`, `axisText` mirrors
 * `--muted-foreground` — all three verified ≥ 4.5:1 for axis text on the chart
 * background in lib/palettes.test.ts.
 */
const palettes: Record<PaletteId, { dark: ChartColorPalette; light: ChartColorPalette }> = {
  original: { dark, light },

  raceplex: {
    dark: {
      background: 'hsl(240, 8%, 9%)',
      grid: 'hsl(240, 6%, 18%)',
      axisText: 'hsl(240, 6%, 64%)',
      tooltipBg: 'hsla(240, 8%, 9%, 0.9)',
      tooltipBorder: 'hsl(240, 6%, 22%)',
      scrubCursor: 'hsl(351, 88%, 57%)',
      zeroLine: 'hsla(240, 6%, 64%, 0.4)',
      refLine: 'hsla(240, 6%, 64%, 0.5)',
      deltaText: 'hsl(0, 0%, 88%)',
    },
    light: {
      background: 'hsl(0, 0%, 100%)',
      grid: 'hsl(240, 6%, 88%)',
      axisText: 'hsl(240, 5%, 40%)',
      tooltipBg: 'hsla(0, 0%, 100%, 0.95)',
      tooltipBorder: 'hsl(240, 6%, 82%)',
      scrubCursor: 'hsl(351, 79%, 41%)',
      zeroLine: 'hsla(240, 5%, 40%, 0.4)',
      refLine: 'hsla(240, 5%, 40%, 0.5)',
      deltaText: 'hsl(240, 10%, 20%)',
    },
  },

  classic: {
    dark: {
      background: 'hsl(220, 30%, 11%)',
      grid: 'hsl(220, 22%, 24%)',
      axisText: 'hsl(215, 18%, 68%)',
      tooltipBg: 'hsla(220, 30%, 11%, 0.9)',
      tooltipBorder: 'hsl(220, 22%, 28%)',
      scrubCursor: 'hsl(351, 88%, 59%)',
      zeroLine: 'hsla(215, 18%, 68%, 0.4)',
      refLine: 'hsla(215, 18%, 68%, 0.5)',
      deltaText: 'hsl(0, 0%, 92%)',
    },
    light: {
      background: 'hsl(0, 0%, 100%)',
      grid: 'hsl(220, 20%, 86%)',
      axisText: 'hsl(220, 18%, 36%)',
      tooltipBg: 'hsla(0, 0%, 100%, 0.95)',
      tooltipBorder: 'hsl(220, 20%, 78%)',
      scrubCursor: 'hsl(351, 79%, 41%)',
      zeroLine: 'hsla(220, 18%, 36%, 0.4)',
      refLine: 'hsla(220, 18%, 36%, 0.5)',
      deltaText: 'hsl(220, 45%, 18%)',
    },
  },

  retro: {
    dark: {
      background: 'hsl(219, 46%, 13%)',
      grid: 'hsl(219, 30%, 26%)',
      axisText: 'hsl(42, 20%, 72%)',
      tooltipBg: 'hsla(219, 46%, 13%, 0.9)',
      tooltipBorder: 'hsl(219, 30%, 30%)',
      scrubCursor: 'hsl(345, 88%, 61%)',
      zeroLine: 'hsla(42, 20%, 72%, 0.4)',
      refLine: 'hsla(42, 20%, 72%, 0.5)',
      deltaText: 'hsl(42, 32%, 90%)',
    },
    light: {
      background: 'hsl(44, 40%, 97%)',
      grid: 'hsl(40, 22%, 82%)',
      axisText: 'hsl(219, 24%, 34%)',
      tooltipBg: 'hsla(44, 40%, 97%, 0.95)',
      tooltipBorder: 'hsl(40, 22%, 74%)',
      scrubCursor: 'hsl(345, 72%, 36%)',
      zeroLine: 'hsla(219, 24%, 34%, 0.4)',
      refLine: 'hsla(219, 24%, 34%, 0.5)',
      deltaText: 'hsl(219, 58%, 20%)',
    },
  },

  neon: {
    dark: {
      background: 'hsl(220, 11%, 9%)',
      grid: 'hsl(220, 10%, 18%)',
      axisText: 'hsl(195, 12%, 66%)',
      tooltipBg: 'hsla(220, 11%, 9%, 0.9)',
      tooltipBorder: 'hsl(190, 30%, 24%)',
      scrubCursor: 'hsl(0, 85%, 66%)',
      zeroLine: 'hsla(195, 12%, 66%, 0.4)',
      refLine: 'hsla(195, 12%, 66%, 0.5)',
      deltaText: 'hsl(150, 12%, 92%)',
    },
    light: {
      background: 'hsl(0, 0%, 100%)',
      grid: 'hsl(200, 16%, 88%)',
      axisText: 'hsl(200, 14%, 36%)',
      tooltipBg: 'hsla(0, 0%, 100%, 0.95)',
      tooltipBorder: 'hsl(200, 16%, 80%)',
      scrubCursor: 'hsl(0, 72%, 41%)',
      zeroLine: 'hsla(200, 14%, 36%, 0.4)',
      refLine: 'hsla(200, 14%, 36%, 0.5)',
      deltaText: 'hsl(200, 40%, 18%)',
    },
  },
};

/**
 * Chart chrome for the active theme.
 *
 * `palette` falls back to `'original'` — the base `:root`/`.dark` tokens — rather
 * than the app's *default* palette, so a caller that doesn't know the palette
 * still gets the unstyled base chrome instead of silently borrowing another
 * palette's. In the app, pass `useSettingsContext().palette`.
 */
export function getChartColors(isDark: boolean, palette: PaletteId = 'original'): ChartColorPalette {
  const set = palettes[palette] ?? palettes.original;
  return isDark ? set.dark : set.light;
}
