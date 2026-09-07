# 0014 — Reporting a data issue: local diagnostics + a prefilled GitHub issue

**Status:** done
**Date:** 2026-09-07

## Problem

A rider imports a file and something is wrong — blank map, no laps, missing
channels, or an outright parse error — and there's no way to tell us short of
manually describing it and hoping we can guess. We can't reproduce a parser bug
without the actual file, and without a request ID or comment thread there's no
diagnostic (rejected-row counts, detected channel list, the actual parse error)
short of asking the rider to open dev tools themselves.

RacePlex has no backend (Golden Rule 1) and no support inbox. `trackContribution.ts`
already solved an equivalent problem for track submissions (plan 0008): do the
work client-side, then hand the rider a prefilled GitHub issue instead of a
server endpoint. This plan applies the same pattern to data-import bug reports.

## Design

- **Client-side diagnostics only.** `lib/dataIssueReport.ts` runs the file through
  the real `parseDatalogFile()` and captures what a maintainer needs: file
  name/size/extension, success/failure, the thrown error (if any), sample count,
  duration, detected channel names, and `ParserStats`' rejected-row breakdown.
  Pure and unit-tested, no React, no network — same shape as `trackContribution.ts`.
- **No auto file upload.** There is nowhere to send it. The rider opens a prefilled
  GitHub issue (`ReportDataIssueDialog`, mirroring `SubmitTrackDialog`'s
  open-a-prefilled-issue flow) and attaches the actual file themselves by dragging
  it into the GitHub issue body — URL prefill can't carry attachments, same
  limitation `trackContribution.ts` already documents. **This requires a GitHub
  account**; the dialog says so up front rather than letting the rider discover it
  at the last step.
- **Privacy warning is not optional.** A GPS log's first and last fixes are
  frequently the rider's home. The issue is public. The dialog states this
  plainly before the "open issue" step — the diagnostic summary alone never
  contains coordinates or raw rows, only counts and channel names; only the file
  the rider chooses to drag in does.
- **New issue template**, `.github/ISSUE_TEMPLATE/data_import_issue.yml`, separate
  from the generic `bug_report.yml` (whose file-format dropdown had drifted stale —
  fixed here too, see below) — same reasoning `track_submission.yml` used for
  splitting off track submissions: a structured field (`diagnostic-report`) needs
  a home a freeform bug report doesn't have.
- **No detected-parser name in the report.** `datalogParser.ts`'s router is
  explicitly fragile (CLAUDE.md Golden Rule 3b) and its ordering is load-bearing;
  duplicating its detection logic just for a diagnostic label risks drift. The
  channel list + rejected-row breakdown already tell a maintainer which parser
  almost certainly matched without touching the router.
- **Mounted in the same three places as `DataExportSection`** (Settings, Tools tab,
  Files drawer) since it's the same kind of "get help with your local data"
  utility, and follows its precedent of skipping i18n (`DataExportSection` has no
  `useTranslation` calls either — this is a low-traffic settings-adjacent surface,
  not core UI).

## Incidental finding (not fixed here)

While tracing `datalogParser.ts`'s async route, `routeDatalogFile()` checks RaceChrono
CSV v3 twice: once inside `NAMED_TEXT_ROUTES` (wins first, routes through the
*sync* generic-CSV importer — no column-mapping confirmation dialog), and again
afterward via a dead `if (isRaceChronoCsvV3(text))` branch that can never run. Net
effect: RaceChrono CSV imports never get the interactive mapping confirmation,
even on the interactive import path. Left alone — out of scope for this plan.
