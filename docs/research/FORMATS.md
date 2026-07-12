# Telemetry format research

> **Status: living document.** This is an open notebook, not a spec. Corrections very welcome —
> especially from anyone who owns hardware we don't. Open questions are marked **[OPEN]**.
> Anything marked **[VERIFIED]** we have confirmed against a real file or an official document;
> anything marked **[REVERSE-ENGINEERED]** comes from third parties and may break at any firmware
> update.

RacePlex ingests GPS/telemetry from consumer performance meters. This document records what those
formats actually are — including several places where the popular understanding is simply wrong.

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

## ⚠️ Myth: "Dragy exports CSV"

It does not. Dragy's own help centre says so in as many words:

> "Unfortunately, you are unable to do this at the moment."
> — [Dragy help centre, *Can I export data to csv or similar?*](https://dragymotorsports.help.center/article/1022-can-i-export-data-to-csv-or-similar)

Any "Dragy CSV" you find in the wild is some third-party tool's *invented* schema, not a vendor
format. Do not design against it. (`mattholung/DragyDataLab` is the usual source of the confusion.)

**What Dragy actually gives you:**

| App | Export |
|---|---|
| **dragy Connect** (the drag-run app) | Video/image overlay render only. **No data file at all.** |
| **dragy·Lap** (the lap-timer app) | **`.vbo`** — long-press the session in History → export. [VERIFIED] |

Dragy Pro has 128 MB of onboard storage and an in-app file manager, but **the on-device log format
is undocumented** and, as far as we can find, nobody has reverse-engineered it. **[OPEN]**

Sample rate is **not fixed**: DRG70 does up to 25 Hz (10 Hz typical), Dragy Pro is user-selectable
10/25 Hz. **Measure the rate from the data; never assume it.**

> Sideways route worth knowing: godragy.com lists **Dragy Pro as a compatible BLE GPS source for
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

#### 🔥 The `Speed` column has no unit, and it is not m/s

This is the single nastiest thing we found, and we only caught it because we had a real file.

The exporter offers `speedFormat = kph | mph | mps`, and then writes the header as a bare **`Speed`**
regardless of which you picked. **The unit is simply not in the file.**

We resolved it empirically — derive speed from the lat/lon deltas and compare:

```
derived from positions : mean 6.03 m/s,  max 28.02 m/s
CSV "Speed" column     : mean 21.64,     max 100.82
ratio                  : 3.588   →  kph   (1.0 would be m/s, 2.24 mph)
```

So RacePlex **auto-detects the unit by measuring the column against the positions**
(`core/parse/util.ts` → `detectSpeedUnit`). Assuming a default would have made every speed in the
app 3.6× wrong — while still looking entirely plausible. That's the worst class of bug: the kind
nobody notices.

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
- **A BLE notification is NOT a packet.** The docs are explicit that a notification may contain a
  partial packet, several packets, or both. A ring buffer with `B5 62` resync + length + checksum
  validation is **mandatory**, not an optimization.

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

### 🔥 Coordinates are in MINUTES, and longitude is POSITIVE-WEST

```
+03658.54711  →  3658.54711 / 60  =  60.9758 °N
-001359.41    →  -1359.41   / 60  = -22.657  →  negate  →  +22.657 °E
```

Get this wrong and every ride still parses, still plots, and still looks completely plausible — just
in the wrong hemisphere at 1/60th scale. It fails **silently**. It has its own test with a known
real-world coordinate (`tests/vbo.test.ts`).

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

1. **`Speed` is kph, not m/s** — recovered by measurement, not documentation (above).
2. **`GyroX/Y/Z` exist** in mobile exports though the cloud exporter has no such option.
3. **It's a point-to-point course, not a circuit.** The GPX carries `<wpt name="Start">` and
   `<wpt name="Finish">` at *different* places (~85 m apart), and RaceBox's own `Lap` column marks a
   single timed run of **36.480 s**. A circuit-only lap engine finds **zero** laps in this file.
   RacePlex therefore supports both course types — and uses that 36.480 s as ground truth in tests.
4. **The GPX splits the ride across 4 `<trkseg>`s.** They're one continuous ride; concatenate them.
5. **GPX has no speed channel** — it must be differentiated from position (and smoothed, or 25 Hz
   GPS noise makes the chart unreadable).
6. **RaceBox writes `<siv>` for satellites**, where the GPX standard says `<sat>`. Accept both.
7. **Sample intervals are 40 ms with 154 dropped samples out of 3628.** So sample rate must be the
   **median** interval, never the mean.
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
- [Dragy — can I export CSV? (official; the answer is no)](https://dragymotorsports.help.center/article/1022-can-i-export-data-to-csv-or-similar)
- [dragy·Lap VBO export announcement](https://www.facebook.com/dragymotorsports/photos/dragylap-app-supports-vbo-file-export-long-press-the-session-in-the-history-page/771389701664065/)
- [jremick/dragy-dash — the only real Dragy BLE protocol notes](https://github.com/jremick/dragy-dash)
- [jLynx/RaceChrono-to-CSV — `.rcz` decoding + a genuine CSV v3 sample](https://github.com/jLynx/RaceChrono-to-CSV)
- [RaceChrono — creating a custom track (the trap model)](https://racechrono.com/article/1923)
- [RaceChrono forum — optimal lap = sum of best sectors](https://racechrono.com/forum/d/2631)
- [lbulej/vbo-tools](https://github.com/lbulej/vbo-tools)


---

## VESC Tool CSV  ✅ [VERIFIED against a real Onewheel ride]

The format that matters most for eskate, because it is the only one that puts **motor current,
battery sag, duty cycle and ERPM on the same timeline as GPS**. A nosedive is a duty-cycle event; a
GPS trace only shows you the aftermath.

Schema confirmed from the writer itself — `vedderb/vesc_tool`, `vescinterface.cpp` (header emitter
lines 1772–1829, row emitter 468–526). **55 columns, `;`-delimited, with a trailing `;`.**

### 🔥 Four things the internet gets wrong about this format

1. **There is NO `kmh_gnss` column.** It is widely cited — it was in our own first research notes —
   but it is one of vesc_tool's internal *display* names (`pageloganalysis.cpp`) and is never
   written to disk. The real column is **`gnss_gVel`, and it is in METRES PER SECOND**. Read it as
   km/h and every speed is 3.6× too low, while still looking entirely plausible. (Measured against
   position-derived speed on a real log: ratio **0.974**.) Same story for `trip_gnss` (derived, not
   stored) and `gnss_h_acc` (actually `gnss_hAcc`).

2. **The GPS repeats — and the obvious fix is WRONG.** The ESC logs at ~12 Hz; the GNSS only fixes
   at ~1 Hz, so lat/lon are repeated across ~12 consecutive rows. The tempting fix is to keep one
   sample per GPS fix. **That also downsamples the ESC channels to 1 Hz** — and a duty-cycle spike
   lasting 0.2 s is *2 samples at 12 Hz and 0.2 samples at 1 Hz*. You would ship a VESC importer
   that cannot see the one event it exists to show. RacePlex keeps **every ESC row** and
   **interpolates position** between fixes.

3. **The trailing `;`** means a naive split yields 56 tokens for 55 columns, and every positional
   index runs off the end.

4. **Do not parse by position**, even though vesc_tool's own reader does. Third-party apps (Float
   Control, Floaty) emit *subsets* of these columns in *different orders*.

### Two dialects
- **RT log** — bare column names (`gnss_gVel`). This is what we've verified.
- **VESC Express / SD card** — header tokens tagged `key:name:unit:precision:...`. Handled by
  `csvTable.ts`, but **[OPEN]** — nobody has sent us one. See issue #15.

---

## Generic CSV  ✅

Any delimited log with a latitude and a longitude now imports, **including from devices we have
never seen**. This is deliberately a *mapper*, not a parser-per-device, because the one thing every
eskate format has in common is that **its column set is not stable**:

- **pOnewheel generates its columns per-ride**, from whichever BLE attributes that ride recorded. A
  fixed column map for it is *impossible by construction*.
- **Float Control reorders columns between app versions** — two real exports have `ADC1`/`ADC2` at
  positions 6–7 in one and 18–19 in the other.
- **TrackAddict's** columns depend on which sensors and OBD-II PIDs were switched on.

So: delimiter sniffed by counting, `#` comment lines kept aside, phantom trailing column dropped,
columns mapped **by name**, and the mapping **shown to the user to correct** before import. The
correction is remembered against a hash of the header row.

### 🔥 The two units that silently corrupt data
Both produce output that *charts beautifully and is wrong*, which is worse than failing:

- **Time.** `ms_today` (ms since local midnight), `Time(s)` (seconds since start), `time` (epoch ms),
  `UTC Time` (epoch **seconds** as a float) — indistinguishable from the column name. Inferred, then
  **shown** (first timestamp, duration, sample rate) so a wrong guess is obvious.
- **Speed.** `gnss_gVel` is m/s; `Speed (Km/h)` is km/h; `speed_kph` is km/h. **Measured against
  position-derived speed**, never guessed from the values.

⚠️ **And the measurement must run on the DISTINCT GPS FIXES, not the raw rows.** On a log with 1 Hz
GNSS and 10 Hz rows, nine of every ten row-gaps show zero movement, so the few that move appear to
cover a full second of travel in 100 ms:

```
column is m/s | raw rows -> m/s  ok      | distinct fixes -> m/s ✓
column is kph | raw rows -> m/s  ✗ WRONG | distinct fixes -> kph ✓
column is mph | raw rows -> m/s  ✗ WRONG | distinct fixes -> mph ✓
```

---

## GoPro GPMF (`.mp4`)  ✅ [VERIFIED against hero5.mp4]

**The GPS is already inside the video file.** Every rider films their runs; almost none know the
telemetry is in there. Read entirely in the browser — **no ffmpeg, no upload** — via `gpmf-extract`
(+ `mp4box`) and `gopro-telemetry`, both MIT and lazy-loaded (+0.58 kB to the main bundle; the 235 kB
of decoder sits in chunks that only load on a video import).

- **GPS9** (HERO11+, 10 Hz) preferred over **GPS5** (HERO5–10, 18 Hz). Genuinely usable for lap
  timing, unlike a phone or a watch.
- Accelerometer and gyro come along, merged onto the GPS timebase.
- ⚠️ **The HERO12 has NO GPS.** GoPro removed it. This catches people constantly.
- ⚠️ `useWorker` defaults true but is documented to crash on some browsers — there is a tested
  fallback, plus a stall guard for a *stillborn* worker that never reports and never rejects.
- **[OPEN]** Chapter-split recordings import as separate files.

### Two decoder traps
- `repeatSticky` **inlines** sticky keys onto the sample and deletes `sticky` — reading them the
  documented way silently returns nothing.
- `gopro-telemetry` returns `date` as a **`Date` object**, so `Date.parse()` truncates the
  milliseconds — a quiet ~900 ms error in the session start time.

