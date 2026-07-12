# RacePlex

**Lap timing and telemetry analysis for electric skateboards.**

Merge data from multiple sources — RaceBox, Dragy, RaceChrono, any GPS logger — and see where your
run was actually won or lost: a speed-coloured track map, lap and sector times, an optimal lap, and
two laps overlaid on the same chart.

Runs entirely in your browser. No account, no upload, no backend. Your rides stay on your device.

---

## This is a fork of Dove's DataViewer

RacePlex is a fork of **[Dove's DataViewer](https://github.com/TheAngryRaven/DovesDataViewer)** by
TheAngryRaven — an excellent GPL-3.0 offline-first motorsport telemetry viewer. We are not
rebuilding what it already does well. Its VBO / NMEA / MoTeC / AiM parsers, lap-crossing detection,
sector math, optimal-lap assembly, and the chart and map layers are upstream's work, and the credit
for them is theirs.

**Why fork rather than only contribute?**

1. **Scope.** Upstream targets cars and karts. RacePlex targets electric skateboards — different
   speeds, different course shapes (a bike path or a slalom run, not a circuit), and a telemetry
   channel set no car tool cares about (VESC motor current, battery sag, ERPM).
2. **Direction.** Upstream is growing a hosted backend and subscription tiers. That is entirely
   their right, and the GPL protects it exactly as much as it protects us. RacePlex commits to
   staying free and fully local — every feature, for everyone.

**On upstreaming:** RacePlex is its own project and makes no commitment to feed changes back. We do
try to stay *mergeable* with upstream — they ship quickly and we'd like to keep pulling their
improvements — so we follow their conventions where doing so is free, and deviate where we think we
have a better answer. If a change we make is useful to them, they are of course welcome to take it;
that is what the licence is for.

**Licence: GPL-3.0-or-later**, inherited from upstream and kept deliberately. Anything built on
RacePlex stays open. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

## What RacePlex adds

| | Status |
|---|---|
| **GPX import** — no upstream parser exists | in progress |
| **RaceBox CSV import**, with automatic speed-unit detection | in progress |
| **RaceChrono CSV v3 import** | planned |
| **Point-to-point courses** (start ≠ finish) — hill runs, slalom, drag | in progress |
| **Timing lines auto-derived from GPX waypoints** — lap timing with zero setup | in progress |
| **Generic Web Bluetooth** live capture for RaceBox / Dragy (upstream's BLE is locked to its own hardware) | planned |
| **VESC channels** — motor current, battery sag, ERPM alongside GPS | planned |

## Supported hardware

RaceBox (Mini / Mini S / Micro), Dragy, RaceChrono exports, and anything emitting GPX, NMEA or VBO —
which is most GPS loggers.

⚠️ **Dragy does not export CSV.** This is a widespread misconception; the vendor confirms it. Use the
*dragy·Lap* app's `.vbo` export instead. See [docs/research/FORMATS.md](docs/research/FORMATS.md).

## Documentation

**[docs/research/FORMATS.md](docs/research/FORMATS.md)** — a sourced write-up of every telemetry
format we ingest: byte layouts, column headers, and the several places where the conventional wisdom
is simply wrong (VBO stores coordinates in *minutes*, positive-*west*; RaceBox's `Speed` column
carries no unit in the header and is not m/s). Corrections and additions very welcome.

## Development

Upstream uses **Bun** as its sole package manager — `bun.lock` is committed and other lockfiles are
gitignored on purpose. Please don't introduce one.

```sh
bun install
bun run dev          # http://localhost:5173
bun run test:run     # 2000+ unit tests
bun run typecheck
```

A fresh clone runs fully offline — cloud, auth and admin features are compiled out unless you supply
your own backend credentials.

## Contributing

Parsers and device support are the most valuable thing you can add, and the easiest place to start.

If you own hardware we don't (which is most of it), **just sending us a sample export file is a real
contribution.** Every format quirk documented in `FORMATS.md` was found by looking at a real file —
not by reading a spec.
