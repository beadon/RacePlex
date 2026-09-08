# 0038 — Session header: breadcrumb + drop the in-session Tools tab

**Status:** done

## Problem

Reported live, with screenshots: opening a session swaps the Dashboard's nav
for a different tab bar (Simple/Pro/Lap Times/Tools/Setups & Notes) that gave
no indication which session was loaded, no obvious way back to the
dashboard, and a "Tools" tab whose contents (Stance Visualizer, Seat
Position Visualizer, My Data) have nothing to do with the loaded session —
all three are session-agnostic calculators, already reachable from the
Dashboard.

## What changed

- **Breadcrumb.** The header's home button (logo + "RacePlex", already
  wired to `markExplicitClose()` + `clearSession()`) gained a `›` and the
  loaded session's display name, using the same
  `formatSessionDisplayName()` (`fileBrowserTree.ts`) the file browser uses —
  a saved `displayName` override wins, else the session's start date/time.
  Reads as "RacePlex › 9/8/2026 3:51 AM", making both facts visible at once:
  which session this is, and that the logo/name to its left is the way back.
  `useSessionMetadata` now exposes `displayName` (it previously tracked
  every other `FileMetadata` field except this one).
- **Tools tab removed from the session view.** `PanelSlot.Tools` (the
  first-party tools plugin's contribution) is still rendered — just not
  here. It's independently reachable from the Dashboard via
  `ToolsLandingTile` (`MountSlot.Landing`), so nothing is orphaned; the
  in-session copy was a pure duplicate that didn't belong once you're
  looking at a specific ride. Removed `ToolsTab`'s lazy import, the
  `showTools` panel-count check, the `"tools"` value from `TopPanelView`,
  the tab button, and its render branch — plus the now-unused `tabs.tools`
  i18n key across every locale.

## Files

- `src/pages/Index.tsx` — breadcrumb + Tools-tab removal.
- `src/hooks/useSessionMetadata.ts` — expose `displayName`.
- `src/locales/*/session.json` — drop the unused `tabs.tools` key.

## Verification

`bun run typecheck` / `bun run lint` / `bun run test:run` (2693 tests) /
`bun run build` all green. Verified live via `bun run dev`: header now reads
"RacePlex › 9/8/2026 3:51 AM" with the phone-GPS badge alongside it, the tab
bar no longer offers Tools (Simple/Pro/Lap Times/Setups & Notes only), and
clicking the RacePlex logo still returns to the dashboard.
