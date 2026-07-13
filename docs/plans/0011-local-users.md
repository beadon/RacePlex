# 0011 — Local users (offline profiles)

## Goal

RacePlex is a single-machine PWA today: everything a rider builds up — files,
vehicles, setups, notes, lap snapshots, chart preferences, settings — lives in
one shared bucket per browser profile. That's fine when one person owns the
device. It breaks on:

- A shared laptop at the track.
- One person testing across builds ("me on the school board" vs "me on the race
  board") who wants each build's data cleanly separated.
- Any future where we want multi-family or club use.

Goal: introduce a **local-only "active user" concept**, no auth, no cloud, so a
rider can create profiles, switch between them, and never accidentally see
another user's data.

## Constraints

- **No auth, no backend.** Users are local records in IndexedDB. Anyone with the
  device can pick any profile. This matches how a family shares an Apple TV, not
  how a work laptop logs in.
- **Offline-first (Golden Rule 1).** Nothing about this reaches the network.
  Cloud sync (`plugins/cloud-sync/`) becomes per-user later; not part of this
  change.
- **Migration must not lose data.** Existing single-machine data on upgrade →
  bulk-assigned to a default "Me" user on first run of the new build.
- **One active user at a time.** Simplifies every read: the store is already
  filtered. No cross-user views yet.
- **Tracks stay global.** A track exists in the world, not per-user.
- **Cascade on delete.** Deleting a user deletes every scoped row they own — the
  user is asked to confirm and told exactly what will be erased.

## Model

### The `users` store

New IDB store: `users` (bumps `DB_VERSION` to 14).

```ts
export interface LocalUser {
  id: string;          // uuid
  name: string;        // nickname OR "First Last" — user's choice
  createdAt: number;
  updatedAt?: number;
}
```

The active user id lives in `localStorage` (`raceplex:activeUserId`), not IDB,
because it's per-installation UI state and needs to be readable synchronously
during app startup to pick the right settings key.

### Scoped stores

Every store that holds per-user data grows an indexed `userId` column. New
records write it on save; the migration back-fills existing rows.

| Store              | Key field         | Migration action                                    |
|--------------------|-------------------|----------------------------------------------------|
| `files`            | `name`            | add `userId` field, index by `userId`              |
| `metadata`         | `fileName`        | same                                               |
| `karts` (vehicles) | `id`              | same                                               |
| `engines`          | `id`              | same                                               |
| `notes`            | `id`              | same                                               |
| `setups`           | `id`              | same                                               |
| `setup-revisions`  | `id` (hash)       | same                                               |
| `lap-snapshots`    | `id`              | same                                               |
| `graph-prefs`      | `sessionFileName` | same                                               |
| `video-sync`       | `sessionFileName` | same                                               |
| `session-videos`   | `sessionFileName` | same                                               |
| `vehicle-types`    | `id`              | same (built-in types stay shared — see below)      |
| `setup-templates`  | `id`              | same                                               |
| `weather-cache`    | `fileName`        | same                                               |

**Not scoped:** `tracks` (localStorage, one world map for everyone).

**Built-in vehicle types**: the app ships a default eSkateboard type. These
stay shared across users — a `userId === null` marks a shared/built-in row and
reads from every user include those. New user-created types default to the
active user; they can toggle "shared" later if we ever add that (out of scope
here).

### Settings (localStorage)

`useSettings` today keys off a single string. Change the key to
`raceplex:settings:<userId>` so switching profiles switches themes, unit
preferences, hidden fields, and every other UI toggle. On first migration, the
existing settings blob is copied under the default "Me" user's key.

### Every store module changes shape

The read side becomes user-scoped. A helper on `dbUtils.ts`:

```ts
export function activeUserId(): string {
  const id = localStorage.getItem(ACTIVE_USER_KEY);
  if (!id) throw new Error("no active user — bootstrap should have created one");
  return id;
}
```

`listX()` filters by `activeUserId()`. `saveX(record)` stamps `userId` if not
set. `deleteX(id)` still deletes by key (the active-user filter isn't needed
for deletion since we already own the id).

Cross-user reads (used only by the user-manager panel's "delete user" cascade
and the migration itself) go through explicit `listXForUser(userId)` helpers,
opt-in per store — the default path stays scoped.

## Approach

Slices, each a commit citing plan 0011.

1. **Storage plumbing** — `users` store, `activeUserId()` helper, migration
   (v13 → v14): create default "Me" user, back-fill every scoped store with
   that user's id, copy settings under the new key. All existing hooks keep
   working; nothing calls the new helper yet.
2. **Scope one store as pilot** — `engines` (small, isolated). Read/write goes
   through `activeUserId()`. Test that switching a fake active-user id changes
   what the hook returns.
3. **Scope the rest** — files/metadata/vehicles/notes/setups/snapshots/prefs/
   videos/types/templates/weather. Each is a mechanical change.
4. **UserSwitcher UI in the app header** — dropdown at the top of the site,
   shows active user + a "Manage users" link, clicking a name switches. Live
   switch triggers a settings reload and a garage-events flush so open panels
   refetch under the new scope.
5. **Users CRUD panel** — Settings modal gains a "Users" section: list, add
   (name only), rename, delete (with cascade confirm listing counts:
   "will erase 12 sessions, 3 vehicles, 47 setups, 8 snapshots").
6. **Cascade on delete** — iterate every scoped store, delete every row where
   `userId === deletedId`, then delete the settings key. Not transactional
   across stores (IDB won't do that); log any per-store failure and continue.
7. **cloud-sync becomes per-user** — the plugin scopes its remote namespace
   under the active user. Left for the plugin author to opt-in.

## Rejected alternatives

- **Full auth (Supabase or otherwise).** Explicitly ruled out: the user wants
  a fully local install with no runtime backend. Adding auth is a strict
  regression on that.
- **One IDB DB per user.** IDB does support named DBs — could open
  `dove-file-manager-<userId>`. Rejected: schema migrations would run N times,
  cross-user cascade delete would require managing DB handles instead of
  filtering, and every existing store module would keep an old
  `openDB(name?)` signature bolted on. Filtering by `userId` is a one-time
  cost per store and stays uniform.
- **Cross-user views (leaderboards across profiles).** Nice-to-have, but out
  of scope now. Would only need `listFilesForUser(id)` helpers which we're
  adding anyway.
- **Deleting `publicProfile` and other cloud fields.** Out of scope; those
  live in `plugins/cloud-sync/` and stay dormant when the plugin is off.

## Touch points

- `src/lib/dbUtils.ts` — DB_VERSION 13 → 14, `USERS` store, migration.
- `src/lib/localUserStorage.ts` — new, CRUD for `users` + active-user helpers.
- `src/lib/userMigration.ts` — new, one-shot v13→v14 back-fill (idempotent).
- Every scoped `src/lib/*Storage.ts` — add `userId` write, filter reads.
- `src/hooks/useSettings.ts` — key on active user id, reload on switch.
- `src/hooks/useLocalUsers.ts` — new hook (list/add/rename/delete + active).
- `src/components/AppShell.tsx` — user switcher in the header.
- `src/components/SettingsModal.tsx` — Users section.
- `src/components/DeleteUserConfirm.tsx` — new, cascade preview.
- `src/lib/garageEvents.ts` — emit a special `type: 'user-switch'` event so
  every `useAsyncSnapshot` hook refetches under the new scope.

## Testing

- Migration: v13 fixture DB → run migration → assert every scoped row has the
  default user's id, tracks are untouched, settings are copied.
- Scoping: seed two users; save records as user A; switch to user B; assert
  reads return empty.
- Cascade delete: seed two users each with files/vehicles/setups; delete
  user A; assert only user B's rows remain.

## Status

- **Landed end-to-end.** Slices 1-6 complete:
  - `users` store + v14 migration back-fills every scoped row with the
    default seed user's id, so upgraders don't lose anything.
  - Every user-owned storage module scopes reads by `activeUserIdOrDefault()`
    and stamps `userId` on write. Built-in vehicle types + setup templates
    remain shared (rows with `userId === undefined`).
  - Header switcher (`UserSwitcher`) and Settings CRUD panel
    (`UsersManagerPanel`) land the user-facing surfaces.
  - `useSettings` writes under `raceplex:settings:<userId>` (default user
    keeps the plain key for a clean upgrade path). i18n, palette, and
    cloud-sync export all use the same resolver.
  - `cascadeDeleteUser` sweeps every scoped store; `countUserRows` powers
    the delete-confirm preview.
- **Not done, still queued:**
  - Slice 7 — `plugins/cloud-sync` becoming per-user (namespace its remote
    store under the active user id). Left as an opt-in for that plugin.
