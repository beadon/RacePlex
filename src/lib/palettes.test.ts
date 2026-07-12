import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTES, DEFAULT_PALETTE, isPaletteId, type PaletteId } from "./palettes";
import { getChartColors } from "./chartColors";

/**
 * The palettes live in index.css as blocks of CSS custom properties, so the CSS is
 * the single source of truth. These tests parse it and hold it to the contract the
 * rest of the app relies on:
 *
 *   1. Every palette's light and dark blocks declare the *same* var set. The light
 *      block `[data-palette=x]` sits after `.dark` at equal specificity, so in dark
 *      mode it would out-rank `.dark` for any var the dark palette block (0,2,0)
 *      does not re-declare. Same key set ⇒ that can't happen.
 *   2. Text clears WCAG AA (4.5:1) on the surface it sits on, in every palette and
 *      both modes — including the data-encoding colours (best lap, success,
 *      warning, destructive) and the alpha-tinted chips they're drawn on.
 *   3. No palette touches `--speed-*`: the `.speed-gradient` legend has to keep
 *      matching the map heatmap's hard-coded gradient (lib/speedHeatmap.ts).
 *   4. The canvas charts' chrome (lib/chartColors.ts, which cannot read CSS vars)
 *      still mirrors each palette's card/border/muted-foreground.
 */

// ── CSS parsing ─────────────────────────────────────────────────────────────────

type Vars = Record<string, string>;

// Read the stylesheet off disk rather than importing it: Vitest stubs CSS imports
// (even with `?raw`) down to an empty string.
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const source = css.replace(/\/\*[\s\S]*?\*\//g, ""); // strip comments before matching

function block(selector: RegExp): Vars {
  const match = source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`));
  if (!match) return {};
  const vars: Vars = {};
  for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[name] = value.trim();
  }
  return vars;
}

const baseLight = block(/:root/);
const baseDark = block(/(?<!\])\.dark(?!\[)/);
const lightBlock = (id: PaletteId) => block(new RegExp(`(?<!\\.dark)\\[data-palette="${id}"\\]`));
const darkBlock = (id: PaletteId) => block(new RegExp(`\\.dark\\[data-palette="${id}"\\]`));

/** The vars that actually apply, following the cascade. */
const effective = (id: PaletteId, mode: "light" | "dark"): Vars =>
  mode === "light"
    ? { ...baseLight, ...lightBlock(id) }
    : { ...baseLight, ...baseDark, ...lightBlock(id), ...darkBlock(id) };

// ── colour maths ────────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

/** Parse a shadcn token — `"351 79% 41%"` — into RGB. */
function parseHsl(token: string): Rgb {
  const [h, s, l] = token.split(/\s+/).map((part) => parseFloat(part));
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}

const toHex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** What `bg-success/15` actually renders as: the colour composited over the card. */
function tint(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as Rgb;
}

const AA = 4.5;
const MODES = ["light", "dark"] as const;

// ── tests ───────────────────────────────────────────────────────────────────────

describe("palette metadata", () => {
  it("defaults to the RacePlex brand palette", () => {
    expect(DEFAULT_PALETTE).toBe("raceplex");
    expect(PALETTES.map((p) => p.id)).toContain(DEFAULT_PALETTE);
  });

  it("recognises exactly the shipped palette ids", () => {
    for (const { id } of PALETTES) expect(isPaletteId(id)).toBe(true);
    expect(isPaletteId("violet")).toBe(false);
    expect(isPaletteId(undefined)).toBe(false);
    expect(isPaletteId(null)).toBe(false);
  });

  it("keeps the upstream look reachable as `original`", () => {
    // `original` is the base :root/.dark, so it must NOT have override blocks —
    // that is what guarantees today's default appearance is bit-for-bit intact.
    expect(lightBlock("original")).toEqual({});
    expect(darkBlock("original")).toEqual({});
    expect(baseLight["primary"]).toBe("276 44% 49%");
    expect(baseDark["primary"]).toBe("276 44% 59%");
  });

  it("previews swatches that really come from the palette", () => {
    for (const { id, swatch } of PALETTES) {
      const hexes = new Set(
        MODES.flatMap((mode) => {
          const vars = effective(id, mode);
          return ["background", "primary", "accent"].map((key) => toHex(parseHsl(vars[key])));
        }),
      );
      for (const colour of swatch) {
        expect(hexes, `${id} swatch ${colour} should be one of its background/primary/accent`).toContain(colour);
      }
    }
  });
});

describe("palette CSS blocks", () => {
  const overridden = PALETTES.filter((p) => p.id !== "original");

  it.each(overridden)("$id declares the same vars in light and dark", ({ id }) => {
    const light = Object.keys(lightBlock(id)).sort();
    const dark = Object.keys(darkBlock(id)).sort();
    expect(light.length).toBeGreaterThan(0);
    // Unequal key sets would let the light block leak into dark mode (see header).
    expect(dark).toEqual(light);
  });

  it.each(overridden)("$id overrides no --speed-* token (heatmap legend stays truthful)", ({ id }) => {
    const declared = [...Object.keys(lightBlock(id)), ...Object.keys(darkBlock(id))];
    expect(declared.filter((name) => name.startsWith("speed-"))).toEqual([]);
  });

  it.each(overridden)("$id keeps the base token set complete", ({ id }) => {
    for (const mode of MODES) {
      const vars = effective(id, mode);
      for (const key of ["background", "foreground", "card", "primary", "muted-foreground", "border", "lap-best"]) {
        expect(vars[key], `${id}/${mode} --${key}`).toBeTruthy();
      }
    }
  });
});

describe("WCAG AA contrast", () => {
  // Every text/surface pair the palettes can affect. The data-encoding rows are the
  // point of the exercise: a palette may restyle chrome, never make a lap time,
  // delta or warning unreadable.
  const pairs = (v: Vars): [string, Rgb, Rgb][] => {
    const c = (key: string) => parseHsl(v[key]);
    return [
      ["foreground on background", c("foreground"), c("background")],
      ["card-foreground on card", c("card-foreground"), c("card")],
      ["popover-foreground on popover", c("popover-foreground"), c("popover")],
      ["muted-foreground on card", c("muted-foreground"), c("card")],
      ["muted-foreground on background", c("muted-foreground"), c("background")],
      ["muted-foreground on muted", c("muted-foreground"), c("muted")],
      ["muted-foreground on secondary", c("muted-foreground"), c("secondary")],
      ["secondary-foreground on secondary", c("secondary-foreground"), c("secondary")],
      ["primary-foreground on primary", c("primary-foreground"), c("primary")],
      ["accent-foreground on accent", c("accent-foreground"), c("accent")],
      ["destructive-foreground on destructive", c("destructive-foreground"), c("destructive")],
      ["warning-foreground on warning", c("warning-foreground"), c("warning")],
      ["success-foreground on success", c("success-foreground"), c("success")],
      // Coloured text on plain surfaces (text-primary, text-destructive, …)
      ["primary text on background", c("primary"), c("background")],
      ["primary text on card", c("primary"), c("card")],
      ["destructive text on card", c("destructive"), c("card")],
      ["warning text on card", c("warning"), c("card")],
      ["success text on card", c("success"), c("card")],
      // Data: the fastest-lap colour (text-racing-lapBest, bg-racing-lapBest/10)
      ["lap-best text on card", c("lap-best"), c("card")],
      ["lap-best text on background", c("lap-best"), c("background")],
      ["lap-best text on its own 10% row tint", c("lap-best"), tint(c("lap-best"), c("card"), 0.1)],
      ["foreground on the 10% best-lap row tint", c("foreground"), tint(c("lap-best"), c("card"), 0.1)],
      // Status chips: bg-success/15 text-success, bg-warning/15 text-warning
      ["success text on its own 15% chip", c("success"), tint(c("success"), c("card"), 0.15)],
      ["warning text on its own 15% chip", c("warning"), tint(c("warning"), c("card"), 0.15)],
      // The lap time on LapTable's selected (primary-tinted) row — the datum that
      // actually has to be readable there.
      ["foreground on the 20% selected-lap row", c("foreground"), tint(c("primary"), c("card"), 0.2)],
    ];
  };

  // `original` is upstream's palette and is knowingly below AA on several data
  // colours (e.g. text-success on white is 3.6:1). It is excluded here rather than
  // silently "fixed", because its whole job is to reproduce the old look exactly.
  const audited = PALETTES.filter((p) => p.id !== "original");

  for (const { id } of audited) {
    for (const mode of MODES) {
      it(`${id}/${mode} clears 4.5:1 everywhere`, () => {
        const failures = pairs(effective(id, mode))
          .map(([label, fg, bg]) => [label, contrast(fg, bg)] as const)
          .filter(([, r]) => r < AA)
          .map(([label, r]) => `${label} = ${r.toFixed(2)}:1`);
        expect(failures).toEqual([]);
      });
    }
  }

  // KNOWN SHORTFALL, inherited — not introduced by the palettes.
  //
  // LapTable draws its sector-sum column as `text-primary bg-primary/10` and that
  // column's header as `text-primary bg-primary/20`: primary-coloured text on a
  // wash of the primary itself. That construction is contrast-capped for *any*
  // hue — the wash drags the background toward the very colour the text is — and
  // it lands under 4.5:1 in every palette including upstream's. It cannot be fixed
  // from a CSS variable: lightening the primary lightens the wash with it, and
  // reaching AA would take Racing Red to salmon. The real fix is in the component
  // (e.g. `text-foreground` on the wash, or a solid `bg-primary
  // text-primary-foreground` header) — but that would change the `original` look,
  // which is out of scope here.
  //
  // So: pin it. On this pair every palette must clear AA — or, where the component
  // makes AA unreachable, be at least as legible as upstream. The red primary can
  // never make it worse than the violet it replaced.
  it("clears AA where the primary is washed over itself, else beats upstream", () => {
    const ratios = (id: PaletteId, mode: (typeof MODES)[number], alpha: number) => {
      const v = effective(id, mode);
      const primary = parseHsl(v["primary"]);
      return contrast(primary, tint(primary, parseHsl(v["card"]), alpha));
    };
    for (const { id } of audited) {
      for (const mode of MODES) {
        for (const alpha of [0.1, 0.2]) {
          const floor = Math.min(AA, ratios("original", mode, alpha));
          expect(
            ratios(id, mode, alpha),
            `${id}/${mode} primary on its own ${alpha * 100}% wash`,
          ).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("keeps the fastest-lap colour distinguishable from the primary in every palette", () => {
    // Neon's brand colour *is* green, so --lap-best moves to lime there. Guard the
    // general rule: the best-lap data colour must never collapse into the brand
    // colour, or a highlighted lap row reads as chrome.
    const hue = (token: string) => parseFloat(token.split(/\s+/)[0]);
    const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const { id } of audited) {
      for (const mode of MODES) {
        const vars = effective(id, mode);
        expect(hueGap(hue(vars["lap-best"]), hue(vars["primary"])), `${id}/${mode}`).toBeGreaterThan(25);
      }
    }
  });
});

describe("canvas chart chrome mirrors the CSS", () => {
  // getChartColors() feeds the <canvas> charts, which can't read custom properties.
  // If it drifts from index.css the chart becomes a mismatched rectangle inside its
  // card, so pin it to the same tokens. `original` is excluded from grid/axis: it is
  // upstream's own hand-tuned chrome and predates these tokens (its dark grid tracks
  // --border, not --chart-grid), and reproducing it exactly is the whole point.
  const numbers = (value: string) => (value.match(/[\d.]+/g) ?? []).join(",");
  const authored = PALETTES.filter((p) => p.id !== "original");

  for (const mode of MODES) {
    it(`original/${mode} still paints the chart on its --card`, () => {
      const chart = getChartColors(mode === "dark", "original");
      expect(numbers(chart.background)).toBe(numbers(effective("original", mode)["card"]));
    });
  }

  for (const { id } of authored) {
    for (const mode of MODES) {
      it(`${id}/${mode} chart chrome tracks --card / --chart-grid / --chart-axis`, () => {
        const vars = effective(id, mode);
        const chart = getChartColors(mode === "dark", id);
        expect(numbers(chart.background)).toBe(numbers(vars["card"]));
        expect(numbers(chart.grid)).toBe(numbers(vars["chart-grid"]));
        expect(numbers(chart.axisText)).toBe(numbers(vars["chart-axis"]));
      });

      it(`${id}/${mode} axis labels are legible on the chart background`, () => {
        const vars = effective(id, mode);
        expect(contrast(parseHsl(vars["chart-axis"]), parseHsl(vars["card"]))).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
