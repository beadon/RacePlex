# RacePlex

**Lap timing and telemetry analysis for electric skateboards.**

Import a ride from a GPS logger, a phone app, a VESC, or a GoPro video, and get a speed-coloured
track map, lap and sector times, an optimal lap, and two laps overlaid on the same chart.

Everything runs in your browser. There is no account, no upload and no backend. Your rides stay on
your device.

---

## A fork of Dove's DataViewer

RacePlex is a fork of [Dove's DataViewer](https://github.com/TheAngryRaven/DovesDataViewer) by
TheAngryRaven, a GPL-3.0 offline-first motorsport telemetry viewer. Its VBO, NMEA, MoTeC and AiM
parsers, the lap-crossing detection, the sector and optimal-lap maths, and the chart and map layers
are upstream's work.

RacePlex exists because upstream targets cars and karts. Electric skateboards run at different
speeds, on different course shapes, with a telemetry channel set that no car tool has reason to
support (VESC motor current, battery sag, ERPM). RacePlex also stays free and fully local; upstream
is building a hosted backend and subscription tiers.

We try to stay mergeable with upstream so we can keep pulling their improvements. We follow their
conventions where that's easy and diverge where we have a good reason. Anything useful here is
theirs to take, under the licence.

**Licence: GPL-3.0-or-later**, inherited from upstream. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

## What RacePlex adds

| | Status |
|---|---|
| **VESC Tool import** — motor current, battery sag, duty cycle and ERPM charted alongside GPS | ✅ done |
| **Generic CSV import** — any delimited log with a lat/lon, with a column mapper you can correct | ✅ done |
| **GoPro `.mp4` import** — reads the GPS from the video's telemetry track, in the browser | ✅ done |
| **GPX import** | ✅ done |
| **RaceBox CSV import**, with automatic speed-unit detection | ✅ done |
| **Point-to-point courses** — hill runs, slalom, drag, where the finish is somewhere else | ✅ done |
| **Lap timing with no setup** — timing lines recovered from the datalog itself | ✅ done |
| **Stance tool** — foot position, weight distribution, and your nosedive threshold | ✅ done |
| **FIT import** (Garmin / Wahoo / Coros) | 🔨 [help wanted](https://github.com/beadon/RacePlex/issues/17) |
| **Live capture over Web Bluetooth** (RaceBox / Dragy) | 📋 [planned](https://github.com/beadon/RacePlex/issues/32) |
| **RaceChrono CSV v3 import** | 📋 [planned](https://github.com/beadon/RacePlex/issues/33) |

---

## Supported devices

The full list — with sample rates, prices and the format to export — lives in
[`src/data/supported-devices.json`](src/data/supported-devices.json) and is shown in the app under
**Supported Devices**. It's plain data; to add a device, open a pull request.

RacePlex sells no hardware and has no affiliation with any of these vendors.

### Recommendations

| | |
|---|---|
| **Best for eskate** | **RaceBox Micro (~$129)** — 25 Hz, IMU, records standalone with a hardware button, exports GPX, VBO and CSV. Our test fixtures come from one. |
| **Best software** | **RaceChrono Pro (~$20)** driving a RaceBox or Dragy over Bluetooth at 25 Hz. Export VBO, NMEA or GPX. Its own CSV format is not supported. |
| **Cheapest** | A bare **u-blox module (~$25)** logging NMEA or UBX to an SD card. |
| **A GoPro you already own** | Drop the `.mp4` in. HERO5–11 and HERO13 record 10–18 Hz GPS inside the video. The HERO12 has no GPS. |
| **A VESC board** | Export the log from VESC Tool. See below. |

### Sample rate

An eskate run often lasts under a minute, so the GPS rate matters more than it does for cars. At
40 km/h:

| Rate | Distance between fixes | |
|---|---|---|
| 1 Hz | 11 m | Phone GPS, Garmin, Strava. Too coarse to place a gate or a braking point. |
| 10 Hz | 1.1 m | Workable. |
| 25 Hz | 44 cm | Recommended. |

A 20-second run at 1 Hz gives you 20 data points. If you're logging with a phone, an external
Bluetooth GPS receiver is the upgrade that matters.

### Two things to know

**Dragy has no CSV export.** The vendor confirms this. Use the dragy·Lap app's `.vbo` export, or run
the Dragy as a Bluetooth GPS source for RaceChrono.

**An unrecognised CSV will still import.** RacePlex reads GPX, VBO, NMEA, UBX, GoPro `.mp4`, and
several named CSV formats (RaceBox, VESC, MoTeC, AiM, Alfano, Dove). Anything else with a latitude
and a longitude falls through to the generic CSV importer, which detects the delimiter, maps the
columns by name, and shows you the mapping so you can correct it before importing. Time and speed
units are inferred and displayed, because a wrong unit produces a chart that looks fine and is
wrong. Your correction is saved against that device's column layout, so you're only asked once.

---

## VESC boards

Export your ride from VESC Tool and import the CSV. The ESC channels come with it: motor current,
battery sag, duty cycle, ERPM and temperatures are charted on the same timeline as GPS.

This is what makes RacePlex useful on a board. A nosedive shows up as a duty-cycle spike, which a
GPS trace can only show you after the fact.

One implementation detail, because it affects what you see: a VESC log writes ESC data at about
12 Hz and GPS fixes at about 1 Hz. RacePlex keeps every ESC row at full rate and interpolates
position between GPS fixes. Sampling down to the GPS rate would leave a 0.2-second duty-cycle spike
as a fifth of a data point.

Float Control, pOnewheel, Metr and FreeSK8 import through the generic CSV path. If one of yours
doesn't work, [send us the file](https://github.com/beadon/RacePlex/issues/15).

---

## Documentation

[docs/research/FORMATS.md](docs/research/FORMATS.md) documents every telemetry format RacePlex
reads: column layouts, byte offsets, and the details that are easy to get wrong. Corrections
welcome.

## Development

RacePlex uses **Bun**. `bun.lock` is committed; other lockfiles are gitignored.

```sh
bun install
bun run dev          # http://localhost:8080
bun run test:run     # 2,300+ unit tests
bun run typecheck
bun run verify:import   # drives a real browser against sample_race_files/
```

A fresh clone runs fully offline. Cloud, auth and admin features are compiled out unless you supply
your own backend credentials.

Versions come from git tags. There is no `CHANGELOG.md` and no `version` field in `package.json`;
release notes live in [GitHub Releases](https://github.com/beadon/RacePlex/releases).

## Contributing

Device and format support is the most useful thing to add, and the easiest place to start.

If you own hardware we haven't tested, **sending a sample export file helps more than code**. Every
format detail documented in `FORMATS.md` came from opening a real file.
