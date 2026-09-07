# 0016 — Discoverability: canonical URLs, a sitemap, and a live domain-name leak

**Status:** done
**Date:** 2026-09-07

## Problem

Riders reported not being able to find RacePlex through search. Auditing the
deployed site's SEO surface (`index.html`, `robots.txt`, canonical tags) turned
up two separate problems, one small and one serious.

**Small: no discovery plumbing.** No `<link rel="canonical">`, no `sitemap.xml`,
and `robots.txt` had no `Sitemap:` directive — all because a code comment said
"RacePlex has no deployed domain of its own yet." That stopped being true when
`beadon.github.io/RacePlex/` went live (CLAUDE.md Project Identity); the comment
just never got updated (Golden Rule 5).

**Serious: several pages actively told search engines RacePlex's content lives
on a different site.** `useDocumentHead()`'s per-route `canonical` override —
inherited verbatim from upstream — pointed `/login`, `/register`,
`/forgot-password`, `/reset-password`, and (critically) the **always-mounted,
ungated** `/delete-account` at `https://lapwingdata.com/...`. A canonical tag is
an instruction to de-index the page it's on in favor of the URL it names — so
RacePlex's own account-deletion page, live on every build for Google Play
compliance, was telling Google its authoritative version was on someone else's
domain. Fixed to point at RacePlex's own URLs.

**`MigrationBanner.tsx` was live, unedited, upstream chrome.** It's upstream's
"HackTheTrack moved to lapwingdata.com" notice — host-gated to `hackthetrack.net`
so it's dormant on RacePlex's actual domain, but reachable via `?migrate=preview`
and confusingly refers to *upstream's own destination* as "RacePlex" (a name
collision with this fork, not a RacePlex bug — just proof this code was never
meant to ship here). RacePlex has no old domain to migrate away from. Deleted,
per Golden Rule 8 (no dead/inapplicable chrome).

**Other same-class leaks, all real user-facing copy, not docs:** the account-
deletion "no cloud in this build" note claimed deletion "applies to the hosted
service at lapwingdata.com" (RacePlex has no such service, full stop — nothing to
point at); `.github/ISSUE_TEMPLATE/config.yml`'s "Live App" contact link and its
Security Vulnerability link both pointed at upstream; a plugin string invited a
rider moving data to go "to lapwingdata.com"; `docs/android.md` told a future
maintainer to register upstream's URL with Google Play as *this app's* deletion
endpoint.

## Fixed

- `index.html`: `<link rel="canonical">` + `og:url` → `https://beadon.github.io/RacePlex/`.
- `public/sitemap.xml` (new) + `robots.txt` `Sitemap:` directive.
- Five `useDocumentHead({ canonical })` calls repointed at RacePlex's own domain.
- `MigrationBanner.tsx` deleted; unmounted from `App.tsx`.
- `.github/ISSUE_TEMPLATE/config.yml`, `docs/android.md`, one plugin i18n string,
  `.env.example`'s header comment, and the cloud-disabled note on
  `/delete-account` — all repointed or reworded to stop naming lapwingdata.com
  as if it were RacePlex's own infrastructure.

## Also: a GitHub link, for the ask that started this

The point of fixing discoverability is for people to actually land somewhere —
so `github.com/beadon/RacePlex` is now one click away. `SiteHeader.tsx` (used by
the cloud-gated Leaderboards/DriverProfile pages) got a `GitBranch`-icon link in
its button cluster, matching `AboutDialog`'s existing "lucide dropped brand
marks" pattern. But **`SiteHeader` is not what a stock build's visitor sees** —
`Dashboard.tsx`'s own comment says it replaced `SiteHeader` and re-homed
Supported-files/About into its own bottom "help row." That's the one every
visitor actually reaches, so the real fix is there: a `GitBranch` "GitHub" link
alongside Supported devices / Supported Files / About, verified rendering and
linking correctly in a live browser check.

## Not done here

- No Google Search Console verification tag — that requires the Google account
  that will own Search Console access for this property, which has to be the
  maintainer's own login, not something bakeable into the repo. Verify via
  Search Console's HTML-tag method and hand the snippet back to add to
  `index.html`, or use the sitemap URL directly once ownership is verified some
  other way (DNS isn't available on a `github.io` subpath).
