/**
 * Selectable colour palettes.
 *
 * A palette is a block of shadcn CSS custom-property overrides keyed off a
 * `data-palette` attribute on `<html>` (see `src/index.css`) — the same trick the
 * `.dark` class already uses, so the two compose: `.dark[data-palette="retro"]`
 * is retro's dark variant. Nothing here is a colour value; the CSS is the single
 * source of truth for what renders. This module only carries the palette *ids*
 * (persisted in settings) and the swatch hexes the Settings picker previews,
 * which `palettes.test.ts` asserts still match the CSS.
 *
 * Data-encoding colours (`--speed-*` for the map heatmap legend, `--lap-best`,
 * `--success`/`--warning`/`--destructive`) are deliberately kept green/amber/red
 * and WCAG-AA legible in every palette — a palette may restyle the chrome, never
 * the meaning of a colour. `--speed-*` is never overridden at all, because the
 * legend has to keep matching the map heatmap's hard-coded gradient
 * (`getSpeedColor` in `lib/speedHeatmap.ts`).
 */

export type PaletteId = 'raceplex' | 'classic' | 'retro' | 'neon' | 'original';

export interface PaletteMeta {
  id: PaletteId;
  /**
   * Three hexes previewed as a swatch in Settings. Each palette shows the trio it
   * is *named* for, so the swatch reads as the palette's identity rather than as
   * whichever mode you happen to be in: the signature surface, the primary, and
   * the accent. Asserted against index.css in palettes.test.ts.
   *
   * The display name is `settings:palette.names.<id>` in the i18n resources.
   */
  swatch: readonly [string, string, string];
}

export const PALETTES: readonly PaletteMeta[] = [
  // Core brand: Racing Red on carbon black, Electric Yellow accent.
  { id: 'raceplex', swatch: ['#0C0C0E', '#BB162F', '#F0E005'] },
  // Motorsport-official: Racing Red, white, deep flag blue.
  { id: 'classic', swatch: ['#FFFFFF', '#BB162F', '#0D3C9C'] },
  // Heritage: navy blue, cherry red, mustard yellow.
  { id: 'retro', swatch: ['#0C1627', '#9E1A3B', '#E6B00F'] },
  // High-tech: neon green and hologram blue on near-black.
  { id: 'neon', swatch: ['#0B0C0E', '#28F67E', '#41DCFB'] },
  // Upstream DataViewer look (violet). Kept selectable so nothing is lost.
  { id: 'original', swatch: ['#FAFAFA', '#8846B4', '#E9B10C'] },
] as const;

export const DEFAULT_PALETTE: PaletteId = 'raceplex';

const PALETTE_IDS = new Set<string>(PALETTES.map((p) => p.id));

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && PALETTE_IDS.has(value);
}

/**
 * Point `<html data-palette>` at a palette. Mirrors how the dark class is applied
 * (App.tsx boots it from localStorage before first paint; Index.tsx keeps it in
 * sync with settings). Falls back to the default for an unknown/absent id, so a
 * stale persisted value can never leave the app with unstyled vars.
 */
export function applyPalette(palette: unknown): PaletteId {
  const id = isPaletteId(palette) ? palette : DEFAULT_PALETTE;
  document.documentElement.setAttribute('data-palette', id);
  return id;
}
