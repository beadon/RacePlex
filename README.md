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
| **VESC Tool import** — motor current, battery sag, duty cycle and ERPM on the same chart as GPS | ✅ done |
| **Generic CSV import** — any delimited log with a lat/lon, with a column mapper you can correct | ✅ done |
| **GoPro `.mp4` import** — the GPS is already in the video; read in-browser, no conversion | ✅ done |
| **GPX import** — no upstream parser exists | ✅ done |
| **RaceBox CSV import**, with automatic speed-unit detection | ✅ done |
| **Point-to-point courses** (start ≠ finish) — hill runs, slalom, drag | ✅ done |
| **Lap timing with zero setup** — timing lines recovered from the datalog itself | ✅ done |
| **Stance tool** — where your feet go, and the deceleration at which you nosedive | ✅ done |
| **FIT import** (Garmin / Wahoo / Coros) | 🔨 [help wanted](https://github.com/beadon/RacePlex/issues/17) |
| **Generic Web Bluetooth** live capture for RaceBox / Dragy | 📋 planned |
| **RaceChrono CSV v3 import** | 📋 planned |

## Supported devices

The full list — with sample rates, prices and the exact format to export — lives in
**[`src/data/supported-devices.json`](src/data/supported-devices.json)** and is shown in-app under
**Supported Devices**. It's plain data: add a device, open a PR.

RacePlex sells no hardware and is affiliated with none of these vendors. A device is listed because
it works.

### The short version

| | |
|---|---|
| **Best buy for eskate** | **RaceBox Micro (~$129)** — 25 Hz, IMU, records standalone with a hardware button, and exports GPX/VBO/CSV, all of which we read. Our test fixtures come from one. |
| **Best software** | **RaceChrono Pro (~$20)** driving a RaceBox or Dragy over Bluetooth at 25 Hz. Export **VBO, NMEA or GPX** — *not* its CSV. |
| **Cheapest** | A bare **u-blox module (~$25)** logging raw NMEA or UBX to an SD card. Drops straight in. |
| **Already own a GoPro?** | **Just drop the `.mp4` in.** HERO5–11/13 log 10–18 Hz GPS inside the video's GPMF metadata track, and RacePlex reads it directly in your browser — no conversion step, nothing uploaded. (The HERO12 has **no GPS at all**.) |

### Why sample rate is the number that matters

An eskate run may last 20 seconds. At 40 km/h:

| Rate | A fix every… | |
|---|---|---|
| 1 Hz (phone GPS, Garmin, Strava) | **11 metres** | can't see a gate, a braking point or an apex |
| 10 Hz | 1.1 metres | usable |
| 25 Hz | **44 cm** | what you want |

A 20-second run at 1 Hz is 20 data points. That's not telemetry, it's a doodle. **An external
Bluetooth receiver — not a better app — is the fix.**

### Two things people get wrong

⚠️ **Dragy does not export CSV.** The vendor confirms it. Use the *dragy·Lap* app's `.vbo` export, or
run it as a Bluetooth source for RaceChrono.

✅ **An unrecognised CSV now imports.** RacePlex reads GPX, VBO, NMEA, UBX and several *specific*
CSV dialects (RaceBox, VESC, MoTeC, AiM, Alfano, Dove) — and anything else with a latitude and a
longitude in it falls through to the **generic CSV importer**, which sniffs the delimiter, maps the
columns by name, and then *shows you the mapping and lets you fix it* before importing. The units it
cannot recover from a column name (time and speed) are inferred and put in front of you, because a
wrong one produces a ride that charts beautifully and is wrong. Your correction is remembered
against that device's column layout, so you are only ever asked once. See
[docs/research/FORMATS.md](docs/research/FORMATS.md).

### If you ride a VESC board

**Your VESC Tool log imports directly** — and it brings the ESC channels with it. Motor current,
battery sag, duty cycle, ERPM and temps land on the **same chart as your GPS trace**.

That's the whole reason an eskate-specific tool deserves to exist: **a nosedive is a duty-cycle
event, not a GPS event.** A GPS trace only ever shows you the aftermath. No car-oriented lap timer
puts those channels next to each other, because no car driver needs them to.

One detail worth knowing, because getting it wrong would quietly ruin the feature: a VESC log writes
the ESC at ~12 Hz but only fixes GPS at ~1 Hz. RacePlex keeps **every ESC row at full rate** and
interpolates position between GPS fixes — rather than the obvious-but-wrong thing, which is to
decimate the log to the GPS rate and throw away the very resolution a duty-cycle spike lives in.
(A 0.2 s spike is 2 samples at 12 Hz, and 0.2 samples at 1 Hz.)

Float Control, pOnewheel, Metr and FreeSK8 import through the generic CSV path. If one of yours
doesn't work, [send us the file](https://github.com/beadon/RacePlex/issues/15) — that is the single
most useful contribution anyone can make.

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
