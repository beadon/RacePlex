# 0008 — Git-native community track collection

**Status:** in progress — `tracks/` + build + CI landed (#19); submit-button rewire
landed (#19); `CLAUDE.md` backend prose corrected (#22).
Remaining: delete the dead `supabase/functions/submit-track`.
**Not doing:** bulk-seeding from OpenStreetMap (see below) — the collection grows
from riders.
**Supersedes (for RacePlex):** upstream's Supabase `submit-track` → `submissions`
table → admin-approve → hand-commit `tracks.json` loop.

## Problem

RacePlex ships **one** track (`public/tracks.json` → Orlando Kart Center, inherited
from upstream's karting world). There is no way for a rider to contribute the hill,
the park, or the parking lot they actually ride. A lap-timing tool with no tracks
is a lap-timing tool nobody can use on day one.

Upstream solved this with a Supabase-backed community database. RacePlex **cannot**
use it, and the reason matters:

- `vite.config.ts` blanks every backend credential (`VITE_SUPABASE_URL: ""`,
  `VITE_ENABLE_CLOUD: "false"`). A RacePlex build has nothing to talk to — grep the
  existing `dist/` for `*.supabase.co` and you get zero hits.
- **The submit button is nevertheless live, and it is broken.** `SubmitTrackDialog.tsx:15`
  and `TrackEditor.tsx:59` each declare `const CLOUD_ENABLED = import.meta.env.VITE_ENABLE_CLOUD === 'true'`
  and then never reference it — dead constants. "Submit N to DB" renders unconditionally
  (`TrackEditor.tsx:507-538`, mounted `:579`), so a user can click it today and reach
  `createClient("", "")` (`integrations/supabase/client.ts:11`), erroring at invoke time.
  This plan therefore also **fixes a live bug**: a visible button that cannot work.
- `supabase/config.toml` still carries **upstream's** project ref
  (`svjlieovpyiffbqwhtgk`). Anyone who "turns the backend on" without noticing would
  be posting RacePlex contributors' tracks into an individual maintainer's private
  database, on their billing, revocable at their discretion.
- `NOTICE` and `README` both promise **no required backend**. A hosted track DB that
  the project depends on to be usable breaks that promise.

So the requirement: **a community track store RacePlex owns, that costs nothing,
works offline, and nobody can revoke.**

## Decision

**Git is the database.** A `tracks/` directory of one JSON file per track is the
canonical store; `public/tracks.json` becomes a generated build artifact. Submission
is a pull request.

This satisfies Golden Rule 1 (offline-first) by construction — the track set ships
in the bundle, so every user holds a full replica — and it costs nothing, because
GitHub already hosts the review flow, the history, the attribution, and the
federation (forks) for free.

### Why not the GitHub wiki

The wiki was the obvious candidate and it loses on every axis that matters:

| | wiki | `tracks/` + PR |
|---|---|---|
| Structured, validated data | prose; nothing stops a malformed lat/lon | JSON + CI schema check |
| Review before it lands | none (or restrict edits, losing "public") | PR review |
| CI / tests | can't — separate repo, not checked out with code | full suite |
| Offline (Rule 1) | rendered HTML on github.com | bundled asset |
| Revert a bad track | manual re-edit | one click |
| Attribution | wiki history, weakly | git blame, contributor list |

A wiki (or a generated Pages site) is a fine **display surface** later — a browsable
index with map thumbnails, *generated from* `tracks/`. It must never be the store, or
it drifts.

## Design

### Record format — one file per track

`tracks/<slug>.json`, slug derived from the track name (`orlando-kart-center.json`).
One file per track, **not** one shared `tracks.json` that PRs edit: two riders
submitting on the same day must not collide in a merge conflict over a file neither
of them can meaningfully resolve.

Each file holds a single track — the same object that is today a value in
`public/tracks.json`, plus its own name and provenance:

```jsonc
{
  "name": "Orlando Kart Center",
  "shortName": "OKC",          // ≤ 8 chars
  "defaultCourse": "Normal",
  "courses": [
    {
      "name": "Normal",
      "lengthFt": 3383,
      "start_a_lat": 28.4127081705638, "start_a_lng": -81.3797326641803,
      "start_b_lat": 28.4127303867932, "start_b_lng": -81.3795704875378,
      // Canonical ordered timing lines after start/finish (courseSectors.ts model).
      // Legacy sector_2_*/sector_3_* are still accepted on read for the tracks
      // inherited from upstream; new submissions emit `sectors`.
      "sectors": [
        { "a_lat": …, "a_lng": …, "b_lat": …, "b_lng": …, "major": true }
      ],
      "layout": [{ "lat": …, "lon": … }]   // optional drawn outline
    }
  ],
  "meta": {                     // provenance — new, not in upstream's shape
    "submittedBy": "github-handle",
    "addedAt": "2026-07-12"
  }
}
```

`layout` moves **into** the track file. Upstream keeps outlines in a parallel
`public/drawings.json` keyed `"SHORT/Course"`; splitting one contribution across two
files that must be edited in lockstep is a bad PR ergonomic. The build script can
still emit `drawings.json` for the existing `loadCourseDrawings()` consumer.

### Build step

`scripts/build-tracks.mjs` — read `tracks/*.json`, validate, emit
`public/tracks.json` (and `public/drawings.json`). Wire it as a `prebuild` script so
`bun run build` can't ship a stale artifact, and check the generated files in (they
must exist for `bun run dev` without a build).

**Two pieces of existing logic get ported, not reinvented:**

- `supabaseAdapter.buildTracksJson()` (`src/lib/db/supabaseAdapter.ts:244-303`) already
  emits exactly the target shape, including deriving `lengthFt` from
  `length_ft_override` or computing it from the layout polyline. That is the build
  script's serializer. (`buildDrawingsJson()` at `:306-330` likewise.)
- `src/lib/db/submissionMaterialize.ts` already holds the **pure coordinate validation**
  the admin approve path runs. That is the CI validator's core — already written,
  already testable.

**Runtime is untouched.** `trackStorage.loadDefaultTracks()` still
`fetch('/tracks.json')` and still merges the localStorage user overlay. No consumer
changes.

### CI validation (`.github/workflows/tracks.yml`, on PRs touching `tracks/`)

A submission that merges must be *usable*, not merely well-formed. Validate:

1. **Schema** — zod. Required coords present and numeric.
2. **Coordinate sanity** — lat ∈ [-90, 90], lon ∈ [-180, 180]; not (0, 0); the two
   ends of a timing line are within a sane distance of each other (a start/finish
   line is metres wide, not kilometres).
3. **Uniqueness** — no duplicate track `name`; no duplicate `shortName` (it keys
   `drawings.json` and the file browser); no duplicate course name within a track.
4. **Geometry coherence** — where a `layout` is present, start/finish and every
   sector line must actually **cross** it. This is the check that catches a
   coordinate typo, which schema validation never will.
5. **Golden Rule 3b — it must round-trip.** A fixture test feeding each track through
   `courseDetection` + `lapCalculation`. Two bugs have already shipped here with a
   green suite because nothing *called* the correct code; a track file that parses
   but produces no lap is the same class of failure.

Bad data cannot merge. A bad merge reverts in one click.

### In-app submission — no server, no git required

`SubmitTrackDialog` today calls `supabase.functions.invoke('submit-track')`
(`SubmitTrackDialog.tsx:158`); `plugins/cloud-sync/trackAutoSubmit.ts:33` does the
same. Both go away — and with them the dead `CLOUD_ENABLED` constants and the
Turnstile widget (`SubmitTrackDialog.tsx:89-111`), which exists only to rate-limit
an anonymous POST that will no longer happen. Rate-limiting is GitHub's problem now.

`trackAutoSubmit.ts` (silently auto-submits a custom course when a leaderboard
snapshot is posted) has no equivalent here and is **deleted**, not ported: silently
opening a PR on a user's behalf is not a thing we should do.

**`src/lib/trackSubmission.ts` is pure and stays exactly as-is** — it diffs local
tracks against built-ins, classifies each course (`new_track` / `new_course` /
`course_modification`), content-hashes the geometry for dedupe, and remembers what
was already submitted. It references no backend. It was always the right module; it
was just wired to the wrong sink.

New sink: the dialog renders the plan, then offers

- **Copy JSON** — the exact `tracks/<slug>.json` file content, ready to paste.
- **Open a submission** — deep-link to a prefilled GitHub **issue form** with the
  JSON in the body. A rider who has never used git never has to.

An Action turns a valid issue into a PR (or a maintainer does it by hand — at RacePlex's
scale that is not a bottleneck, and it can wait for volume to justify it).

`submittedTracksStorage.ts` (localStorage `racing-datalog-submitted-v1`) keeps
working unchanged: it dedupes on content hash, and it does not care what the sink is.

## Seeding the collection — there is nothing to import

The obvious first move is to bulk-import an existing track set. **There isn't one.**
Checked, so nobody has to check again:

- **Upstream's `public/tracks.json` ships exactly the same single track we do** —
  Orlando Kart Center, 5 courses, byte-identical (`git show upstream/main:public/tracks.json`,
  at 307 merged PRs). They built the whole submission apparatus — form, CAPTCHA, rate
  limiting, `submissions` table, admin review queue, materialization, export button —
  and what actually reaches users is still the one track a developer hand-entered.
  Their publish loop ends in a manual step (*admin clicks "Build tracks.json", downloads
  it, commits it*), and that step has evidently never been run. A PR is the review **and**
  the publish, so it cannot stall in a queue nobody drains — this is the failure mode
  the git-native design removes.
- **Their `tracks`/`courses`/`submissions` tables are `SELECT`-gated to
  `has_role(auth.uid(), 'admin')`** (`supabase/migrations/20260213182724_*.sql:45-101`).
  No anon read path, and no credential in this repo. Reading it would mean getting
  around RLS on a database owned by an individual — do not.
- GPL-3 covers upstream's **code**, not their users' submitted **data**. Even with
  access, bulk-copying it here is not clearly ours to do.

**The collection is seeded by riders, and that is the whole answer.** Bulk-importing
from OpenStreetMap was considered and **rejected** — do not revisit it:

- OSM has kart circuits and race tracks. RacePlex is for **hill runs, slalom, and
  drag** — point-to-point courses (`finishA`/`finishB`) that upstream does not even
  model. The tracks our users want are a stretch of public road somebody rides. They
  are not in OSM, or in anyone's database.
- OSM cannot supply a **start/finish line** anyway — where a lap begins is a judgment
  call, not a map feature. Every import would land as a stub a rider still has to
  finish, so the import buys almost nothing.

Which makes the **cost of submitting** the thing that actually matters, and the reason
the in-app flow hands a rider a ready-to-paste record and a one-click issue. A track
that produces a correct lap time on a real session is worth ten drawn from a map.

## Scope

**In:**
- `tracks/` + the five inherited OKC courses migrated into it.
- `scripts/build-tracks.mjs` + `prebuild` wiring.
- `.github/workflows/tracks.yml` + the validator (`scripts/validate-tracks.mjs`,
  unit-tested per Golden Rule 3).
- `SubmitTrackDialog` → copy-JSON + issue deep-link. Delete the two edge-fn calls.
- `.github/ISSUE_TEMPLATE/track-submission.yml`.
- `CONTRIBUTING.md` section: how to add a track.
- Docs: `README.md`, `CLAUDE.md` architecture map, `CHANGELOG.md`.

**Out (deliberately):**
- Deleting `supabase/` wholesale. Out of scope here; the dead `submit-track` function
  and upstream's `project_id` are a separate cleanup.
- Generated map-thumbnail index / Pages site. Wants tracks first.
- Issue→PR automation. Manual until volume justifies it.

## Risks

- **`CLAUDE.md` currently lies.** It describes the Supabase backend as live and
  auto-configured ("auto-set; `vite.config.ts` has public fallbacks"), contradicting
  `vite.config.ts` and `NOTICE`. That stale inherited text is precisely how someone —
  human or agent — re-points this fork at upstream's database by accident. **Fix it
  as part of this plan**, not after.
- **Divergence from upstream.** Upstream keeps its Supabase path; we drop it. This
  is an intentional, load-bearing deviation (the fork's whole thesis), not free
  mergeability. Expect conflicts in `SubmitTrackDialog.tsx` on future merges and
  resolve in RacePlex's favour.
- **Scale.** PR-per-track is fine at tens-to-hundreds of tracks. If it ever becomes
  thousands, revisit — but a self-hosted DB is a much bigger commitment than that
  problem is currently worth.

## Verification

Per Golden Rule 3b, a green suite proves nothing about wiring:

1. `bun run build` regenerates `public/tracks.json` byte-identical to the current
   committed file, from the migrated `tracks/*.json`. (No behaviour change on the
   inherited data — the safest possible first step.)
2. Add a deliberately broken track file; CI must fail on each of the five checks.
3. **Run the app.** Load a session, confirm the track list, confirm course
   auto-detection, confirm lap times. Then `bun run verify:import` — ground truth is
   still 36.480 s from the RaceBox `Lap` column.
