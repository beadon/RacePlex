# 0036 — Paginate session lists 10 at a time

**Status:** done

## Problem

Two places listed sessions with no pagination once the list grew large:

- The Dashboard's "Recent sessions" tile fetched every file but only ever
  showed a fixed first 6, with no way to see the rest short of opening the
  file-manager drawer — a hard cap, not pagination.
- The file-manager drawer's `SessionBrowser` (shared by `FilesTab` and the
  cloud-sync plugin's `CloudLogsPanel`) rendered every session in the
  current Track→Course folder at once, unbounded — a track with a season's
  worth of sessions renders every row in one long list.

## What changed

Both now show 10 sessions at a time with a "Show N more" control appending
the next page, rather than either a silent hard cap or an unbounded list.

- **`SessionBrowser.tsx`**: local `visibleCount` state, reset to the first
  page when navigation moves to a different folder (keyed off the
  breadcrumb path, using React's recommended "adjust state during render"
  pattern rather than an effect — this codebase's stricter lint rules flag
  both a raw `.current` read during render and a synchronous `setState`
  inside a plain effect). Verified live: seeded 15 sessions into one
  course, confirmed the drawer showed 10 with "Show 5 more", and that
  clicking it revealed the rest with the control then gone.
- **`RecentSessionsTile.tsx`**: dropped the old `RECENT_LIMIT = 6` hard cap
  entirely (including the `.slice(0, RECENT_LIMIT * 2)` at fetch time,
  which only ever over-fetched by 2x — never enough to page through a
  larger set anyway) in favor of the same paginated `visibleCount` pattern.
  The header now reads "10 of 18 shown" once paginated, "18 shown" once
  fully expanded. Verified live the same way: seeded sessions to 18 total,
  confirmed "10 of 18 shown" + "Show 8 more", then confirmed expanding to
  "18 shown" with the control gone.

Neither the folder-drilling browser nor the flat dashboard tile needed a
new pure/tested module — this is `.tsx` view-layer pagination state, out of
scope for this repo's coverage requirements the same way `RECENT_LIMIT`'s
old slicing logic was.

## Files

- `src/components/SessionBrowser.tsx`
- `src/components/dashboard/RecentSessionsTile.tsx`
- `src/locales/en/drawer.json` — new `browser.showMore` key (English-only;
  other locales are best-effort per this repo's i18n policy).

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2685 tests) /
`bun run build` all green, plus the two live browser checks above (seeded
real IndexedDB records via the browser console, not mocked).
