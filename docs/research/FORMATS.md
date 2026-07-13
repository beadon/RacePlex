# Telemetry format research

> **Status: living document.** Corrections are welcome, especially from anyone who owns hardware we
> don't. Open questions are marked **[OPEN]**.
> Anything marked **[VERIFIED]** we have confirmed against a real file or an official document;
> anything marked **[REVERSE-ENGINEERED]** comes from third parties and may break at any firmware
> update.

This document records the telemetry formats RacePlex reads: their layouts, their units, and the
details that are easy to get wrong. Several widely-repeated claims about these formats are
incorrect; those are flagged where they come up.

---

## TL;DR for implementers

| Source | File export | Live BLE | Notes |
|---|---|---|---|
| **RaceBox** (Mini / Mini S / Micro) | **CSV, VBO, GPX, KML** | **Documented** (official PDF) | The well-behaved citizen. Everything is public. |
| **VESC Tool** | **CSV** (semicolon-delimited) | n/a | ✅ **Supported.** The only format that carries the ESC channels next to GPS. See below. |
| **GoPro** (HERO5–11, 13) | the **`.mp4` itself** — GPS is in the GPMF metadata track | n/a | ✅ **Supported**, read in-browser. No ffmpeg, no conversion. HERO12 has no GPS. |
| **Anything else with a CSV** | **CSV** | n/a | ✅ **Supported** via the generic importer + column mapper. Float Control, pOnewheel, Metr, TrackAddict, Qstarz… |
| **Dragy** (DRG70 / Pro) | **VBO only**, from the *dragy·Lap* app | [REVERSE-ENGINEERED] | **No CSV export exists.** See below. |
| **RaceChrono** | **VBO, CSV v3, NMEA**; native `.rcz` | n/a (it's an app) | Imports VBO — so VBO is our export target too. |

**Status:** VBO, RaceBox CSV, GPX, NMEA, UBX, **VESC CSV**, **GoPro GPMF** and a **generic CSV**
fallback are all implemented. FIT (Garmin/Wahoo/Coros) is the main gap — see issue #17.

---

## Dragy has no CSV export

It does not. Dragy's own help centre says so in as many words:

> "Unfortunately, you are unable to do this at the moment."
> — [Dragy help centre, *Can I export data to csv or similar?*](https://dragymotorsports.help.center/article/1022-can-i-export-data-to-csv-or-similar)

Any file described as a "Dragy CSV" comes from a third-party tool that invented its own schema.
There is no vendor format to implement. (`mattholung/DragyDataLab` is the usual source of the
confusion.)

**What Dragy actually gives you:**

| App | Export |
|---|---|
| **dragy Connect** (the drag-run app) | Video/image overlay render only. **No data file at all.** |
| **dragy·Lap** (the lap-timer app) | **`.vbo`** — long-press the session in History → export. [VERIFIED] |

Dragy Pro has 128 MB of onboard storage and an in-app file manager, but **the on-device log format
is undocumented** and, as far as we can find, nobody has reverse-engineered it. **[OPEN]**

Sample rate is **not fixed**: DRG70 does up to 25 Hz (10 Hz typical), Dragy Pro is user-selectable
10/25 Hz. **Measure the rate from the data; never assume it.**

> godragy.com lists **Dragy Pro as a compatible BLE GPS source for
> RaceChrono**. So a Dragy owner can feed RaceChrono and export from there — which may be a cleaner
> path than us touching Dragy at all.

---

## RaceBox

The best-documented device in the category, by a wide margin.

### CSV [VERIFIED against a real export]

**Six presets emit six different column sets**, plus a bike mode that swaps columns. There is no
single "RaceBox CSV". **Parse off the header row; never use fixed column indices.**

| Preset | Header |
|---|---|
| `custom` (default) | `Record,Time,Latitude,Longitude,Altitude,Speed,GForceX,GForceY,GForceZ,Lap` |
| `custom` + bike mode | `Record,Time,Latitude,Longitude,Altitude,Speed,GForceX,GForceZ,Lap,LeanAngle` |
| `telemetryoverlay` | `…,Altitude (m),Speed (m/s),GForceX (g),…,Lap,Heading` |
| `racerenderer` | `Record,Time,Latitude,Longitude,Altitude,KPH,X,Y,Z,Lap` |
| `fastlap` | as `custom` but **no `Record` column** |

An optional metadata block (`Format,RaceBox` / `Track,…` / `Lap N, <time>, sectors, …`) may precede
a blank line and then the header — **or may be absent entirely**, as it is in our sample file.

#### The `Speed` column carries no unit

This is the single nastiest thing we found, and we only caught it because we had a real file.

The exporter offers `speedFormat = kph | mph | mps`, and then writes the header as a bare **`Speed`**
regardless of which you picked. **The unit is simply not in the file.**

We resolved it empirically — derive speed from the lat/lon deltas and compare:

```
derived from positions : mean 6.03 m/s,  max 28.02 m/s
CSV "Speed" column     : mean 21.64,     max 100.82
ratio                  : 3.588   →  kph   (1.0 would be m/s, 2.24 mph)
```

RacePlex detects the unit by measuring the column against speed derived from the positions
(`detectSpeedUnit`). Assuming a default would make every speed in the app 3.6× wrong, and the charts
would still look reasonable, so the error would be easy to miss.

*(Also note: `telemetryoverlay` and `seriousracing` force m/s **regardless** of the requested
`speedFormat`. The header annotation is trustworthy when present; the bare header is not.)*

#### Gyro columns exist (contradicting the cloud exporter)

Our real mobile-app export carries `GyroX,GyroY,GyroZ`. The *cloud* exporter does not emit them and
has no option for them. Both are real; header-driven parsing handles both. **[VERIFIED]**

### BLE protocol [VERIFIED — official PDF, Revision 8]

Source: [RaceBox Mini/Micro protocol documentation](https://www.racebox.pro/products/mini-micro-protocol-documentation)

- **Nordic UART Service.** Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`, notify on `…0003`,
  write on `…0002`. Advertised name starts `RaceBox Mini ` / `RaceBox Mini S ` / `RaceBox Micro `.
- **Web Bluetooth compatible** — pure GATT, no classic SPP. Requires HTTPS + a user gesture, and
  lowercase UUIDs. No pairing/bonding needed.
- **UBX framing:** `B5 62 | class | id | len (u16 LE) | payload | CK_A CK_B` (8-bit Fletcher).
- **Live data = class `0xFF`, id `0x01`, 80-byte payload.** Recorded history = id `0x21` with an
  **identical payload layout** — so one decoder serves both live capture and offline download.
- **A BLE notification does not map to one packet.** The documentation is explicit: a notification
  may contain a partial packet, several packets, or both. You need a ring buffer with `B5 62`
  resync, length and checksum validation.

Payload highlights (all little-endian):

| Offset | Field | Scaling |
|---|---|---|
| 24 | Longitude | ÷ 1e7 → deg |
| 28 | Latitude | ÷ 1e7 → deg |
| 32/36 | WGS / MSL altitude | **millimetres** |
| 48 | Speed | **mm/s** |
| 52 | Heading | ÷ 1e5 → deg |
| 68–72 | GForce X/Y/Z | ÷ 1000 → g |
| 74–78 | Rotation X/Y/Z | ÷ 100 → deg/s |

Good-fix test: `fixStatus == 3 && (fixStatusFlags & 0x01)`.

At 25 Hz this is ~2.2 KB/s — bandwidth is a non-issue. Main-thread jank is the real risk; buffer and
parse off the hot path.

The official doc ships **an example packet with its decoded values**, which we use as a known-answer
unit test — meaning the decoder can be verified with **no hardware at all**.

### Cloud JSON API [VERIFIED, undocumented]

`GET https://www.racebox.pro/webapp/session/{id}/json` returns 200 **with no auth** for public
sessions: columnar `dataColumns`/`data` arrays, **speed in kph**, plus the track's start/finish and
split lines as lat/lng pairs. The highest-fidelity import path if a user shares a session link.
**[OPEN]** — is this stable/sanctioned enough to depend on?

---

## VBO (RaceLogic VBOX)

Text format, `[header]` / `[comments]` / `[laptiming]` / `[column names]` / `[data]` sections.

### Coordinates are in minutes, and longitude is positive-west

```
+03658.54711  →  3658.54711 / 60  =  60.9758 °N
-001359.41    →  -1359.41   / 60  = -22.657  →  negate  →  +22.657 °E
```

A file read with the wrong convention still parses and still plots, in the wrong hemisphere at
1/60th scale, so the error is silent. There is a test against a known real-world coordinate
(`tests/vbo.test.ts`).

`velocity` is **km/h**. `time` is `HHMMSS.ss` time-of-day UTC (watch for midnight rollover).

---

## RaceChrono

### CSV v3 [VERIFIED against a real export]

- Sniff on **line 2 = `Format,3`**. File is **UTF-8 with BOM**.
- Metadata key/value lines, then **three header rows**: channel names, units, and **source device**
  (`100: gps`, `200: canbus`, `calc`).
- **Column names are NOT unique.** `speed` and `device_update_rate` each appear twice (once from
  GPS, once computed). **Key columns on `(name, source)`** — never on name or position alone.
- Channels are resampled onto one timebase, so nominally-integer channels arrive **fractional**:
  `satellites` reads `15.1`, `fix_type` reads `1.0`. Don't assume ints.
- The column set is **dynamic** (depends on which devices were connected).

### What RaceChrono itself imports

From the app's own import dialog — effectively a ranked roadmap for our own importer:

> GPX · NMEA 0183 · VBOX/VBOX Sport · Qstarz BL-1000GT · DriftBox/PerformanceBox · AIM Data Logger ·
> Tesla Track Mode · Race Tech DL-1 · Renault RS · iRacing · RaceChrono v1.xx

Note **VBO is on the list** (so VBO is our export target), and **no Dragy format is** — independent
confirmation of the myth above.

### Track model

RaceChrono's track *library* format is undocumented and its old `track.bin` is an obsolete J2ME
artifact. **[OPEN]** But the *semantics* are documented, and we mirror them: a track is a set of
**traps** — `{lat, lon, bearing, widthM (default 50), type, bidirectional}` — which converts
trivially to a two-point line segment for crossing tests.

**Optimal lap = the sum of the best time set in each sector**, across all complete laps (confirmed by
the RaceChrono developers on their forum). It equals your best lap when that lap was fastest
everywhere, and is faster otherwise.

---

## What the real sample file taught us

`sample_race_files/RaceBox Track Session…` — a real RaceBox export, CSV + GPX of the same ride.
Every one of these is now a test:

1. **`Speed` is in kph.** Recovered by measuring the column against the positions (above).
2. **`GyroX/Y/Z` exist** in mobile exports though the cloud exporter has no such option.
3. **The course is point-to-point.** The GPX carries `<wpt name="Start">` and
   `<wpt name="Finish">` at *different* places (~85 m apart), and RaceBox's own `Lap` column marks a
   single timed run of **36.480 s**. A circuit-only lap engine finds **zero** laps in this file.
   RacePlex therefore supports both course types — and uses that 36.480 s as ground truth in tests.
4. **The GPX splits the ride across 4 `<trkseg>`s.** They're one continuous ride; concatenate them.
5. **GPX has no speed channel** — it must be differentiated from position (and smoothed, or 25 Hz
   GPS noise makes the chart unreadable).
6. **RaceBox writes `<siv>` for satellites**, where the GPX standard says `<sat>`. Accept both.
7. **Sample intervals are 40 ms, with 154 dropped samples out of 3628.** Take the sample rate from
   the **median** interval; dropped samples pull the mean off.
8. **Timing lines travel in the GPX as waypoints** — which means we can reconstruct the track
   geometry from the file and give the user working lap timing with zero setup. We infer each
   line's direction from the rider's heading as they passed it.

---

## Open questions — help wanted

- **[OPEN]** Dragy Pro's on-device binary log format. Nobody appears to have touched it.
- **[OPEN]** Dragy's BLE beyond the basic handshake — is there an IMU packet, or must lateral/
  longitudinal g be derived from speed+heading? [REVERSE-ENGINEERED] sources derive it.
- **[OPEN]** Is the RaceBox cloud `/json` endpoint stable enough to build an importer on?
- **[OPEN]** Sensible default trap width for eskate. RaceChrono defaults to **50 m**, which is sized
  for cars on a circuit. That may be far too wide for a slalom course or a bike path.
- **[OPEN]** Do we want to ingest **VESC** telemetry (motor current, battery, RPM) alongside GPS?
  That's the channel set no car-oriented tool has, and arguably where an eskate-specific app earns
  its existence.

## Sources

- [RaceBox BLE protocol, Rev 8 (official)](https://www.racebox.pro/products/mini-micro-protocol-documentation)
- [RaceBox session export (official)](https://www.racebox.pro/info/session-export)
- [Dragy — can I export data to CSV? (official)](https://dragymotorsports.help.center/article/1022-can-i-export-data-to-csv-or-similar)
- [dragy·Lap VBO export announcement](https://www.facebook.com/dragymotorsports/photos/dragylap-app-supports-vbo-file-export-long-press-the-session-in-the-history-page/771389701664065/)
- [jremick/dragy-dash — the only real Dragy BLE protocol notes](https://github.com/jremick/dragy-dash)
- [jLynx/RaceChrono-to-CSV — `.rcz` decoding + a genuine CSV v3 sample](https://github.com/jLynx/RaceChrono-to-CSV)
- [RaceChrono — creating a custom track](https://racechrono.com/article/1923)
- [RaceChrono forum — optimal lap = sum of best sectors](https://racechrono.com/forum/d/2631)
- [lbulej/vbo-tools](https://github.com/lbulej/vbo-tools)


---

## VESC Tool CSV  ✅ [VERIFIED against a real Onewheel ride]

The format that matters most for eskate, because it is the only one that puts **motor current,
battery sag, duty cycle and ERPM on the same timeline as GPS**. A nosedive is a duty-cycle event; a
GPS trace only shows you the aftermath.

Schema confirmed from the writer itself — `vedderb/vesc_tool`, `vescinterface.cpp` (header emitter
lines 1772–1829, row emitter 468–526). **55 columns, `;`-delimited, with a trailing `;`.**

### Four common mistakes

1. **There is no `kmh_gnss` column.** It's widely cited, including in our own first research notes,
   but it's one of vesc_tool's internal display names (`pageloganalysis.cpp`) and never appears on
   disk. The speed column is **`gnss_gVel`, in metres per second**. Read as km/h it comes out 3.6×
   too low, and the charts still look reasonable. (Measured against position-derived speed on a real
   log: ratio 0.974.) The same applies to `trip_gnss`, which is derived rather than stored, and to
   `gnss_h_acc`, which is actually spelled `gnss_hAcc`.

2. **The GPS repeats.** The ESC logs at about 12 Hz and the GNSS fixes at about 1 Hz, so lat/lon
   are repeated across roughly 12 consecutive rows. Keeping one sample per GPS fix also drops the
   ESC channels to 1 Hz, which leaves a 0.2-second duty-cycle spike as a fifth of a data point.
   RacePlex keeps every ESC row and interpolates position between fixes.

3. **The trailing `;`** means a naive split yields 56 tokens for 55 columns, and every positional
   index runs off the end.

4. **Parse by column name.** vesc_tool's own reader is positional, but third-party apps (Float
   Control, Floaty) emit subsets of these columns in different orders.

### Two dialects
- **RT log** — bare column names (`gnss_gVel`). This is what we've verified.
- **VESC Express / SD card** — header tokens tagged `key:name:unit:precision:...`. Handled by
  `csvTable.ts`, but **[OPEN]** — nobody has sent us one. See issue #15.

---

## Generic CSV  ✅

Any delimited log with a latitude and a longitude imports, including from devices we have never
seen. It works as a column mapper because these formats have unstable column sets:

- **pOnewheel generates its columns per ride**, from whichever BLE attributes that ride recorded,
  so there is no fixed column map to write.
- **Float Control reorders columns between app versions** — two real exports have `ADC1`/`ADC2` at
  positions 6–7 in one and 18–19 in the other.
- **TrackAddict's** columns depend on which sensors and OBD-II PIDs were switched on.

So: delimiter sniffed by counting, `#` comment lines kept aside, phantom trailing column dropped,
columns mapped **by name**, and the mapping **shown to the user to correct** before import. The
correction is remembered against a hash of the header row.

### Time and speed units

Both of these produce charts that look correct while being wrong, so they are worth getting right:

- **Time.** `ms_today` (ms since local midnight), `Time(s)` (seconds since start), `time` (epoch ms),
  `UTC Time` (epoch **seconds** as a float) — indistinguishable from the column name. Inferred, then
  **shown** (first timestamp, duration, sample rate) so a wrong guess is obvious.
- **Speed.** `gnss_gVel` is m/s; `Speed (Km/h)` is km/h; `speed_kph` is km/h. RacePlex measures the
  column against speed derived from the positions.

⚠️ **Measure against the distinct GPS fixes.** On a log with 1 Hz GNSS and 10 Hz rows, nine of every
ten row-gaps show no movement, so the gaps that do move appear to cover a full second of travel in
100 ms. Measuring against raw rows gives:

```
column is m/s | raw rows -> m/s  ok      | distinct fixes -> m/s ✓
column is kph | raw rows -> m/s  ✗ WRONG | distinct fixes -> kph ✓
column is mph | raw rows -> m/s  ✗ WRONG | distinct fixes -> mph ✓
```

---

## GoPro GPMF (`.mp4`)  ✅ [VERIFIED against hero5.mp4]

GoPro records GPS into the video file's GPMF metadata track. RacePlex reads it in the browser with
`gpmf-extract` (plus `mp4box`) and `gopro-telemetry`, both MIT-licensed. No ffmpeg or upload is
involved. The libraries are lazy-loaded: they add 0.58 kB to the main bundle, and the 235 kB decoder
loads only when you import a video.

- **GPS9** (HERO11+, 10 Hz) preferred over **GPS5** (HERO5–10, 18 Hz). Genuinely usable for lap
  timing, unlike a phone or a watch.
- Accelerometer and gyro come along, merged onto the GPS timebase.
- ⚠️ **The HERO12 has no GPS.** GoPro removed it for that model.
- ⚠️ `useWorker` defaults to true but is documented to crash on some browsers. There is a tested
  fallback, plus a stall guard for a worker that starts but never reports or rejects.
- **[OPEN]** Chapter-split recordings import as separate files.

### Two decoder details
- `repeatSticky` inlines sticky keys onto the sample and deletes `sticky`. Reading them the
  documented way returns nothing.
- `gopro-telemetry` returns `date` as a `Date` object. Passing it to `Date.parse()` truncates the
  milliseconds, giving a ~900 ms error in the session start time.

