# Security Policy

## Supported Versions

RacePlex is developed on the `main` branch. Security fixes are applied there.
Older tagged releases are not separately patched.

| Version | Supported |
|---------|-----------|
| Latest `main` | ✅ |
| Older tags | ❌ |

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Report privately through GitHub's
[private vulnerability reporting](https://github.com/beadon/RacePlex/security/advisories/new)
on this repository (**Security → Report a vulnerability**).

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce (a proof of concept if possible).
- The affected area (e.g. a specific parser).

### If the issue is inherited from upstream

RacePlex is a fork of
[Dove's DataViewer](https://github.com/TheAngryRaven/DovesDataViewer), and most
of the parsing and lap engine is their code. If you find a vulnerability that
also affects upstream, please **also report it to them**, so their users are
protected too — we will do the same if we find one. Please don't publicly
disclose an upstream issue without giving them a chance to fix it.

## What to Expect

- An acknowledgement of your report.
- An assessment and, if confirmed, a fix on `main` as quickly as is practical.
- Credit for the discovery if you'd like it (let us know your preference).

## Scope Notes

RacePlex is **offline-first and client-side**: telemetry files are parsed
entirely in the browser and are never uploaded. There is no RacePlex backend.
The security-relevant surface is therefore small, and is almost entirely about
**handling untrusted files**:

- **File parsers** (`src/lib/*Parser.ts`) — the main attack surface. They ingest
  arbitrary user-supplied datalogs (GPX, CSV, VBO, NMEA, UBX, MoTeC, AiM,
  iRacing), including malformed and hostile ones. A parser that can be made to
  hang, exhaust memory, or act on file contents is a real bug. Note the GPX
  parser is regex-based over XML, so pathological input is a legitimate thing to
  probe.
- **The service worker / PWA cache** (`public/sw.js`, the `vite-plugin-pwa`
  config).
- **Persisted state** (IndexedDB, `localStorage`) — imported files, courses and
  settings are stored locally.

Upstream's optional Supabase backend and its DovesDataLogger BLE flow are present
in the tree but are **not used by RacePlex** — cloud and admin are compiled out by
default. Please report issues in those to upstream.

Thank you for helping keep the project and its users safe.
