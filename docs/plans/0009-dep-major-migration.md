# Plan 0009 — Major-Version Dependency Migration

Bring RacePlex's dependency graph forward to the current major line: **React 19,
Tailwind 4, Vite 8 (Rolldown), TypeScript 6, ESLint 10** (with the React
Compiler ruleset from `eslint-plugin-react-hooks@7`), plus the smaller majors
(react-router-dom 7, react-resizable-panels 4, sonner 2, tailwind-merge 3,
lucide-react 1) that Dependabot has been opening PRs for.

Everything ships on a single branch, `chore/deps-major-migration`, running in a
git worktree at `/Users/beadon/work/RacePlex-deps` (`../RacePlex-deps` from the
main checkout) so other agents can keep editing `main` in the primary checkout
without stepping on the migration.

## Why this plan exists

The eight open Dependabot PRs (#5–#12 on `beadon/RacePlex`) are all failing
their own CI, and their major bumps are coupled: the React types can't move
without React runtime, Tailwind 4 needs a codemod that touches every component,
ESLint 10 needs `typescript-eslint` bumped in lockstep. Merging them one-by-one
would just break `main` repeatedly. This plan bundles the migration into one
coherent effort with visible progress commits so each step is bisectable.

The plan is also the durable state-recovery record: if the working agent hits a
context limit, a fresh agent should be able to open this file, read
`## Resume state`, and pick up exactly where the previous one left off — no
guessing required.

## Constraints (durable across agents)

- **Do it right, not fast.** No `eslint-disable`, no rule downgrades, no
  suppression as a shortcut. Every violation gets a real refactor, even when it
  takes hours. See memory `feedback-do-it-right-not-fast`.
- **Never trust piped exit codes.** `bun run cmd | tail -N` reports `tail`'s
  exit, not `cmd`'s. Always check `bun run cmd; echo "EXIT=$?"` or grep for
  bun's `error: script "..." exited with code N` line. See memory
  `feedback-verify-exit-codes`.
- **Green before merge.** `bun run lint`, `bun run typecheck`,
  `bun run test:run`, `bun run build`, and `bun run verify:import` must all be
  green before the PR opens. Interim commits on this branch may be red on lint
  (as long as the final commit is green) — see `## Interim red-lint policy`.
- **Golden Rule 3b.** After every dep bump, `bun run verify:import` against a
  worktree-local dev server. Lap times must stay at 0:36.520 CSV / 0:36.547 GPX.
  Both sample files must import cleanly.

## Resume state (update after every commit)

**Branch:** `chore/deps-major-migration`
**Worktree:** `/Users/beadon/work/RacePlex-deps`
**Latest commit:** `89b0886` — ESLint 10 + plugins bump + partial refactor pass (WIP)

**Suite state:**
- lint: **62 errors remaining**, all `react-hooks/set-state-in-effect`
- typecheck: green
- test:run: green (2247/2247)
- build: green (Rolldown, ~1.3s)
- verify:import: green (both samples, correct lap times)

**Commits already on the branch (in order):**
1. `765111d` — `chore: sync bun.lock — drop stale @perchwerks/eye-in-the-sky entry`
2. `1aac352` — `chore(deps): bump React 18 → 19 (runtime + types + swc plugin)`
3. `55d14e7` — `chore(deps): bump Tailwind 3 → 4 (CSS-first config + @tailwindcss/postcss)`
4. `eaf2ef5` — `chore(deps): bump Vite 5→8 + TypeScript 5→6 + @types/node 22→26`
5. `6f4e72b` — `fix: repair typecheck + tests broken by React 19 / TS 6 / Tailwind 4 codemod`
6. `89b0886` — `chore(deps): ESLint 10 + plugins bump + partial refactor pass (WIP)`

## Overall progress (checklist)

- [x] Stash WIP + create branch + baseline green suite
- [x] Bump React 18 → 19 (no source changes needed)
- [x] Bump Tailwind 3 → 4 (codemod + palette verification)
- [x] Bump Vite 5→8 + TypeScript 5→6 + @types/node 22→26 (needed manualChunks
      rewrite for Rolldown + async-config return-type annotation)
- [x] Fix typecheck + test regressions from the above three (Tailwind codemod
      false-positives, TS lib target, Uint8Array<ArrayBufferLike>, React 19
      RefObject nullability)
- [~] Bump ESLint 9 → 10 + eslint-plugin-react-hooks 5 → 7 + friends
  - [x] Install stack, keep rules at v7-recommended (NOT downgraded/suppressed)
  - [x] Clean 59 of 121 initial errors (all six smaller buckets — see below)
  - [ ] Clean the remaining 62 `react-hooks/set-state-in-effect` errors
- [ ] Bump react-router-dom 6 → 7
- [ ] Bump react-resizable-panels 2 → 4
- [ ] Bump sonner 1 → 2, tailwind-merge 2 → 3, lucide-react 0.462 → 1.24
- [ ] Final green suite + verify:import + push branch + open PR + close
      superseded Dependabot PRs (#5–#12)

## ESLint 10 refactor — the 62 remaining sites

Every remaining error is `react-hooks/set-state-in-effect` — v7's opinion that
`setState` should not run synchronously in a `useEffect` body. Grouped by fix
pattern (each is a separate sub-batch, each batch = one commit that keeps every
other check green):

### Group A — Store-manager hooks (build one shared helper first)

Files: `useEngineManager.ts`, `useVehicleManager.ts`, `useSetupManager.ts`,
`useNoteManager.ts`, `useLapSnapshots.ts`, `useLapOverlays.ts` (2 sites),
`useSessionData.ts`, `useSubscription.ts`, `useStripePrices.ts`,
`useWaybackImagery.ts`.

All follow the same shape:
```ts
const [items, setItems] = useState<T[]>([]);
const refresh = useCallback(async () => { setItems(await listX()); }, []);
useEffect(() => { refresh(); }, [refresh]); // ← v7 flags refresh() setState
```

**Approach:** write a shared `useAsyncSnapshot` helper in `src/hooks/` that
takes `{ load: () => Promise<T>, subscribe?: (cb) => () => void }` and returns
`{ data, refresh }`. Under the hood it uses `useSyncExternalStore` — the
canonical React 19 answer. `garageEvents` (`src/lib/garageEvents.ts`) already
provides the subscribe surface for IndexedDB stores.

**Watchpoint:** `useSyncExternalStore` snapshots must be synchronous. Wrap the
async list in a module-level cache keyed by store name; refresh updates the
cache and notifies subscribers.

**Web-search hints if the pattern gets tricky:**
- "useSyncExternalStore async data" → React docs + several 2024 blog posts
  covering the cache-then-notify pattern.
- The React docs page "You Might Not Need an Effect" has the canonical
  external-store example.

### Group B — Admin "load on mount" tabs (~9 sites)

Files: `admin/BannedIpsTab.tsx`, `admin/CoursesTab.tsx` (2 sites),
`admin/LeaderboardsTab.tsx`, `admin/SubmissionsTab.tsx`, `admin/TracksTab.tsx`,
`admin/UsersTab.tsx`, `admin/MessagesTab.tsx` (if present),
`drawer/DeviceTracksTab.tsx`.

Shape: `useEffect(() => { load(); }, [load])` where `load` is a `useCallback`
starting with `setLoading(true)`.

**Approach:** same `useAsyncSnapshot` helper reused, plus a `manualRefresh`
returned so post-mutation triggers still work. If a helper is overkill for a
single tab, inline the `useSyncExternalStore` pattern with a per-tab
module-level cache singleton.

### Group C — "Cloud-sync panels" (~7 sites)

Files: `cloud-sync/StoragePanel.tsx`, `cloud-sync/LeaderboardSubmitPanel.tsx`
(2 sites), `cloud-sync/LapSnapshotsPanel.tsx`, `cloud-sync/FileDeleteToggle.tsx`
(already partially refactored on `89b0886` — the remaining error is separate),
`cloud-sync/DataPrivacyPanel.tsx`, `cloud-sync/CloudLogsPanel.tsx`.

Shape: same as Group B but scoped to a plugin. Reuse the helper.

### Group D — Prop-driven form resets (~10 sites)

Files: `drawer/SetupsTab.tsx` (2), `drawer/PostSessionPanel.tsx`,
`drawer/NotesTab.tsx`, `drawer/DeviceSettingsTab.tsx` (2),
`TrackPromptDialog.tsx` (3), `TrackEditor.tsx` (2), `WeatherPanel.tsx`,
`components/DataloggerDownload.tsx`.

Shape: `useEffect(() => { setForm(fromProp) }, [fromProp])` to reset when a
parent-owned identity changes.

**Approach:** either `key` prop from parent (cleanest — component remounts, all
state resets) or derived state via `useMemo` + a change-detector ref. React
docs prefer `key`. Requires a small edit on the parent for each pair.

### Group E — Tick/subscription/one-shot handoffs (~15 sites)

Files: `pages/Index.tsx` (2 — leaderboard handoff + delta-mode reset),
`pages/DriverProfile.tsx`, `pages/DeleteAccount.tsx`, `usePlayback.ts` (1 —
the tick loop), `useVideoSync.ts` (indirect — TDZ was fixed on `89b0886`,
recheck), `useFirmwareUpdate.ts`, `useLapManagement.ts`, `RaceLineView.tsx`,
`ProfileAvatar.tsx`, `SubmitTrackDialog.tsx`, `graphview/*` (5 files),
`FileManagerDrawer.tsx` (2), `VideoPlayer.tsx` (2 — autohide + overlay).

**Approach:** case-by-case. Most are either (a) a legit external subscription
that should be `useSyncExternalStore`, (b) a "sync derived state on identity
change" that becomes `useMemo`, or (c) a genuine one-shot mount handoff (like
Index's `leaderboardHandoff`) where the fix is to do the work in an event
handler (or route loader) instead of an effect.

## Interim red-lint policy

Green-before-merge is a rule for `origin/main`, not for feature branches.
`chore/deps-major-migration` is allowed to sit with lint errors across
intermediate commits **as long as the branch head is green when the PR opens**.
Each commit's message states its lint delta so the history stays audit-able.

## Later, remaining big rocks (not yet started)

- **react-router-dom 6 → 7.** v7 is essentially "Remix merged in." Breaking
  changes for us are mostly opt-in (`future.v7_*` flags in v6.30 were adopted
  before v7 released, so they're on by default in v7). Real work: check every
  `useNavigate`, `useLoaderData`, `<Route>` in `src/pages/*` and `App.tsx`.
  Also verify `/admin`, `/login`, `/register`, `/leaderboards`,
  `/driver/:username`, `/delete-account` still render + navigate.
- **react-resizable-panels 2 → 4.** Used in `GraphViewPanel.tsx` and the
  `SetupsNotesPanel` split. Check for `PanelGroup`, `Panel`, `PanelResizeHandle`
  API breakage. Test drag + collapse in the browser (verify:import doesn't
  cover this).
- **sonner 1 → 2.** `<Toaster>` prop shape changed. Grep usages, update.
- **tailwind-merge 2 → 3.** `cn()` helper in `src/lib/utils.ts`. Confirm
  behavior with a targeted test if the utility ships one.
- **lucide-react 0.462 → 1.24.** Icon names normalized. `bun run typecheck`
  will catch missing icons; some may need renaming (`Trash` → `Trash2`, etc.).

## Merge-day sequence

1. Confirm `verify:import` matches the ground-truth 36.520 CSV / 36.547 GPX.
2. Run the app in a browser worktree-locally (`bun run dev`) — sanity-check
   the Setups tab, GraphView layout (react-resizable-panels sensitive), a
   route transition per page (react-router 7), and a couple of toasts (sonner).
   Golden Rule 3b says green tests aren't enough.
3. `git push origin chore/deps-major-migration`.
4. `gh pr create --repo beadon/RacePlex --base main` with a body that lists
   every major bump + the migration receipts + the closed Dependabot PRs.
5. `gh pr close 5 6 7 8 9 10 11 12 --repo beadon/RacePlex --comment "Superseded by #<N>"`
   for the eight open npm-major Dependabot PRs.

## Session survival: how to save state before context loss

When context is getting tight but the branch isn't finished:
1. Commit any half-done in-progress refactor as an explicit WIP commit with a
   fully honest commit message (lint delta, remaining count, next-step
   pointer).
2. **Update the `## Resume state` block above** with the exact commit hash and
   the new lint count.
3. Refresh `## Overall progress` checkboxes so the next agent sees the state
   at a glance.
4. Do not squash — the incremental commits ARE the recovery record.
