/**
 * The RacePlex brand mark: a speed trace climbing across chart axes.
 *
 * Inlined as SVG rather than referenced as an image, so the trace can be painted with
 * `--primary` and the axes with `--muted-foreground`. That means the mark simply *is* the
 * active palette — Racing Red under RacePlex and Classic, lime under Lime Trace, cherry under
 * Retro, spring green under Neon — and it stays legible in both light and dark mode without
 * anyone maintaining a matrix of PNGs. The designer's red and lime variants of this mark are
 * the same geometry with a different accent, which is exactly what a CSS variable is for.
 *
 * The fixed-colour PNG exports still exist for the places the web platform won't let us be
 * dynamic — favicon, PWA icons, apple-touch — and those are baked in Racing Red. See
 * `branding/` for the source artwork.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="RacePlex"
      fill="none"
      strokeLinecap="round"
    >
      {/* Chart axes and gridlines. `currentColor` so they inherit the muted foreground set
          below, which keeps them present but subordinate to the trace in every palette. */}
      <g className="text-muted-foreground" stroke="currentColor">
        <line x1="32" y1="55" x2="88" y2="55" strokeWidth="1.4" strokeOpacity="0.45" />
        <line x1="32" y1="34" x2="88" y2="34" strokeWidth="1.4" strokeOpacity="0.45" />
        <line x1="18" y1="14" x2="18" y2="78" strokeWidth="2.8" strokeOpacity="0.9" />
        <line x1="18" y1="78" x2="88" y2="78" strokeWidth="2.8" strokeOpacity="0.9" />
        <line x1="36" y1="78" x2="36" y2="82" strokeWidth="2" strokeOpacity="0.9" />
        <line x1="54" y1="78" x2="54" y2="82" strokeWidth="2" strokeOpacity="0.9" />
        <line x1="72" y1="78" x2="72" y2="82" strokeWidth="2" strokeOpacity="0.9" />
      </g>

      {/* The trace itself — the brand colour. */}
      <path
        d="M26 66 L40 58 L54 62 L68 40 L84 22 L84 78 L26 78 Z"
        fill="hsl(var(--primary))"
        fillOpacity="0.15"
      />
      <polyline
        points="26,66 40,58 54,62 68,40 84,22"
        stroke="hsl(var(--primary))"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <g fill="hsl(var(--primary))">
        <circle cx="40" cy="58" r="3.4" />
        <circle cx="54" cy="62" r="3.4" />
        <circle cx="68" cy="40" r="3.4" />
        <circle cx="84" cy="22" r="4.6" />
      </g>
    </svg>
  );
}
