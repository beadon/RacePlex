# CLAUDE.md — Codebase Intelligence for AI Agents

## Project Identity

**Dove's DataViewer / HackTheTrack** — Open-source, offline-first motorsport telemetry viewer.
- Live: [hackthetrack.net](https://hackthetrack.net) | Published: [dovesdataviewer.lovable.app](https://dovesdataviewer.lovable.app)
- Companion hardware: [DovesDataLogger](https://github.com/TheAngryRaven/DovesDataLogger) (nRF52840 GPS logger with BLE — Seeed XIAO nRF52840, `sense`/`nonsense` IMU variants)
- PWA with full offline support via service worker + IndexedDB

---

## Golden Rules

1. **Offline-first**: 99% of features must work without network. Only weather, satellite tiles, and admin are exceptions.
2. **Modular & reusable**: Prefer small composable modules over monoliths. Rewrites for reusability are always welcome.
3. **Update README.md** when adding parsers, changing env vars, or modifying build params.
4. **Update credits** (in README) when adding new FOSS dependencies.
5. **Never do on the server what you can do on the client.**
6. **Add tests when possible**: New parsers, pure utilities, and protocol/format logic should ship with Vitest coverage. Bug fixes should add a regression test that fails before the fix. Don't leave testable logic untested.
7. **Keep `CHANGELOG.md` updated**: Add user-facing changes under the `[Unreleased]` heading (Keep a Changelog format) as you make them — don't wait for release time. Cut a new version section + tag when releasing.
8. **Keep it professional**: This is a public, released OSS project (v1.5.0+). Hold the bar — see the standards below.

---

## Code Quality & Professional Standards

This repo is public, released, and CI-gated. Treat every change as if a stranger
will read it tomorrow.

- **Green before merge**: `npm run lint`, `npm run typecheck`, `npm run test:run`,
  and `npm run build` must all pass. CI runs them as four separate workflows on
  every PR — don't merge red.
- **Tests are part of the change, not a follow-up.** See Golden Rule #6.
- **Changelog is part of the change.** See Golden Rule #7.
- **Docs stay in sync**: update `README.md`, this file, and the in-app
  `CreditsDialog.tsx` alongside the code that makes them stale (parsers, env
  vars, dependencies, architecture). The README Credits list and `CreditsDialog`
  must agree.
- **Small, focused PRs** with clear commit messages explaining the *why*. Prefer
  a topic branch + PR over committing to `main` directly.
- **No dead code, no boilerplate cruft**: delete unused code rather than
  commenting it out; no leftover `console.log`, no Lovable scaffolding defaults.
- **Comments explain *why*, not *what*** — only where the reason is non-obvious.
- **Respect the bundle budget**: keep lazy boundaries and vendor `manualChunks`
  intact (see Bundle Splitting below) so the initial payload stays small.
- **Honor the conventions below** (Tailwind tokens, composable hooks, parser
  contract, gated admin code). Consistency is a feature.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite + vite-plugin-pwa (`/service-worker.js` active SW, `/sw.js` cleanup kill-switch) |
| Styling | Tailwind CSS + shadcn/ui (HSL design tokens in `index.css`) |
| Mapping | Leaflet (CartoDB + Esri tiles, cached 30 days by SW; satellite view has an Esri **Wayback** imagery-date picker — `lib/satelliteImagery.ts` — to dodge cloud cover) |
| Charts | Custom Canvas 2D (not a library — see `TelemetryChart.tsx`, `SingleSeriesChart.tsx`) |
| Video Export | WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 video + AAC audio → MP4 output) |
| State | React hooks + React Query (for admin only) |
| Drag/Reorder | [dnd kit](https://dndkit.com) (`@dnd-kit/core`+`sortable`+`utilities`) — sector-list reorder; lazy-loaded with the track editor |
| Local Storage | IndexedDB (`dbUtils.ts`) for files/metadata/karts/notes/setups/video-sync/graph-prefs; localStorage for tracks & settings |
| Backend | None for core features. Optional admin via Supabase (Lovable Cloud) |
| BLE | Web Bluetooth API for DovesDataLogger device communication |

---

## Architecture Map

> Directory + entry-point level only. Leaf files are discoverable with
> `Glob`/`Grep`; ★ marks the load-bearing entry points worth knowing by name.

```
src/
├── pages/
│   ├── Index.tsx          # ★ Main SPA — file import, tab views, all state orchestration
│   ├── Admin.tsx          # Admin panel (behind VITE_ENABLE_ADMIN)
│   └── …                  # Login / Register / Privacy / Terms / NotFound
├── components/
│   ├── ui/                # shadcn/ui primitives
│   ├── admin/             # Admin tabs (Tracks, Courses, Submissions, BannedIps, Tools, Messages)
│   ├── tabs/              # View tabs (GraphView, RaceLine, LapTimes, Labs, Coach, Tools; Profile is mounted in the drawer)
│   ├── graphview/         # Pro mode: GraphPanel, GraphViewPanel, MiniMap, SingleSeriesChart, GGDiagram, InfoBox
│   ├── drawer/            # File-manager drawer tabs (Files, Vehicles/Karts, Notes, Setups, Device*)
│   ├── track-editor/      # Track editor sub-components: VisualEditor (lazy Leaflet line placement), SectorListEditor (dnd-kit reorderable sector list — the control surface), CourseSectorEditor (bundles the two), AddCourseDialog/AddTrackDialog
│   ├── video-overlays/    # Video-export overlay system: registry + themes + per-widget *Overlay,
│   │                      #   sectorUtils, dataSourceResolver, OverlaySettingsPanel, VideoExportDialog
│   ├── RaceLineView.tsx   # Leaflet map: race line, speed heatmap, braking zones
│   ├── TelemetryChart.tsx # Canvas speed/telemetry chart (simple mode)
│   ├── VideoPlayer.tsx    # Synced video playback + overlay system
│   ├── LapSnapshot*.tsx   # ★ Lap-snapshot picker (Controls) + "new fastest lap" save prompt
│   └── …                  # FileImport, DataloggerDownload (BLE entry, lazy), ContactDialog, …
├── hooks/                 # One concern each; Index.tsx orchestrates.
│   ├── useSessionData.ts  # Parses imported file → ParsedData
│   ├── useLapManagement.ts# Lap calc, selection, visible range
│   ├── usePlayback.ts     # Shared playback cursor (chart + map)
│   ├── useLapSnapshots.ts # ★ Lap-snapshot orchestration (capture/prompt/overlay)
│   ├── useLapOverlays.ts  # Multi-lap map-overlay selection (lap/snapshot ids → OverlayLine[])
│   ├── useReferenceLap / useVideoSync / useSettings / useSessionMetadata / useOnlineStatus
│   ├── useWaybackImagery.ts# Lazy-loads the Esri Wayback release list on first open of the satellite imagery-date picker (off the initial path; never runs offline)
│   ├── use*Manager.ts     # IndexedDB CRUD: File, Vehicle (←Kart compat), Engine, Template, Note, Setup
│   └── useSubscription / useStripePrices   # billing, online — see docs/backend.md
├── lib/
│   ├── datalogParser.ts   # ★ Format auto-detection router (entry point for all parsing)
│   ├── *Parser.ts         # nmea, ubx, iracing (.ibt), vbo, dove, dovex, alfano, aim, motec (+ parserUtils.ts)
│   ├── xrk/               # ★ AiM .xrk/.xrz importer — libxrk core (Rust→WASM) in a Web Worker
│   │                      #   (xrkImporter entry, xrkWorker, xrkClient, pure xrkResample + xrkMapping,
│   │                      #    xrkConfig/Types, committed wasm/ build artifacts)
│   ├── channels.ts        # ★ Canonical channel registry (ids/labels/units/aliases) + normalizeChannels()
│   ├── fieldResolver.ts   # Settings-facing adapter over channels.ts
│   ├── courseDetection.ts # ★ Auto track/course/direction detection + waypoint mode
│   ├── courseSectors.ts   # ★ Pure sector model: caps (25 lines / 3 majors), normalizeCourseSectors (legacy→array migration at every load boundary), sectorLabels (1/1.1/2…), validateCourseSectors, majorSectorLines + legacyMirror (the logger projection), rollupMajorSectors (fine-grained → S1/S2/S3)
│   ├── lapCalculation.ts  # Start/finish + per-sector crossing detection → Lap[] (sectorTimes[] + sectorBoundaries[] + major rollup); calculateOptimalLap sums best of EVERY segment
│   ├── lapDelta.ts        # ★ Position-based lap delta (arc-length resample + segment-projected gap)
│   ├── fileBrowserTree.ts # ★ Pure file-browser hierarchy: Track→Course→logs, engine/kart filter, breadcrumbs, smart collapse
│   ├── lapOverlays.ts     # ★ Pure multi-lap overlay logic: id format (lap/snap/file), palette, resolve selections → OverlayLine[], unionBounds
│   ├── lapAlignment.ts    # ★ Pure rigid registration (2D Kabsch) to drift-align cross-session overlays onto the current lap (map-only)
│   ├── lapSnapshot.ts     # ★ Pure snapshot types/keying/buffer (course+engine identity)
│   ├── lapSnapshotStorage.ts # ★ IndexedDB CRUD for lap snapshots (emits garageEvents)
│   ├── setupRevision.ts  # ★ Pure content-addressed setup history: hash + freeze (immutable revisions)
│   ├── setupRevisionStorage.ts # ★ IndexedDB CRUD for setup revisions (freezeSetupRevision; emits garageEvents)
│   ├── trackSubmission.ts # ★ Pure community-DB upload plan: diff local tracks vs built-ins → new/edited, geometry hash + dedupe
│   ├── submittedTracksStorage.ts # localStorage record of already-submitted course hashes (dedupe)
│   ├── dbUtils.ts         # ★ Shared IndexedDB: DB_NAME, DB_VERSION, openDB(), tx helpers
│   ├── garageEvents.ts    # ★ Host pub/sub: storage emits {store,key,put|delete}; cloud-sync syncs off it
│   ├── fileLoadingState.ts # ★ Host pub/sub for the global file-load overlay; parseDatalogFile brackets begin/end
│   ├── *Storage.ts        # IDB stores: file, kart(compat), vehicle, engine, template, note, setup,
│   │                      #   video, videoFile, graphPrefs; trackStorage = localStorage (user tracks)
│   ├── (racing math)      # brakingZones, speedEvents, speedBounds, gforceCalculation, referenceUtils, trackUtils
│   ├── (charts/video)     # chartUtils (+ buildSeriesPoints per-pixel min/max decimation),
│   │                      #   canvas2d (prepare2dCanvas conditional buffer resize + strokeSeriesPath),
│   │                      #   chartColors, chartAxis, videoExport, overlayCanvasRenderer
│   ├── speedHeatmap.ts    # ★ Pure bucketed heatmap geometry: speed→color + segments grouped into ~20
│   │                      #   per-color multi-polylines (maps render these via Leaflet's canvas renderer —
│   │                      #   never one layer per GPS segment)
│   ├── mapMarker.ts       # Pure heading math for the maps' position arrow (marker is moved/rotated per tick, not recreated)
│   ├── satelliteImagery.ts # ★ Pure Esri Wayback parsing: waybackconfig.json → date-sorted release list + Leaflet tile URLs (online-only satellite imagery-date picker; useWaybackImagery hook lazy-loads it)
│   ├── ble/               # Web Bluetooth DovesLapTimer protocol, split per-concern (see BLE Integration);
│   │                      #   + bleDatalogger.ts (legacy barrel), deviceTrackSync.ts, deviceSettingsSchema.ts
│   │   ├── firmwareCrc.ts # ★ CRC-32/IEEE (crc32/crc32Hex) for the OTA handshake (known-vector tested)
│   │   ├── firmwareUpload.ts # ★ SD-staged OTA protocol over 0x1820: beginFirmwareUpdate/uploadFirmwareImage/applyFirmware
│   │   └── dfu/           # ★ Firmware update support: firmwareManifest (fetch+pure compare/pick/evaluate),
│   │                      #   dfuPackage (jszip unpack → app .bin), version (DIS read). (Legacy BLE-DFU transport removed — blocklisted.)
│   ├── db/                # Admin DB layer: ITrackDatabase + supabaseAdapter + getDatabase() factory
│   ├── billing.ts         # ★ Pure subscription logic (tiers, coming-soon, annual-discount math), no Supabase import — see docs/backend.md
│   ├── billingClient.ts / pendingCheckout.ts   # Supabase billing I/O + sign-up checkout stash
│   ├── profanity.ts       # Basic client-side profanity filter for display names
│   ├── weatherService.ts  # Historical weather (online-only): US → NWS station + IEM ASOS METAR; else → Open-Meteo reanalysis fallback (keyless, global). fetchSessionWeather orchestrates.
│   ├── buildInfo.ts       # Build version/hash/branch/commit-date stamp (landing footer "what changed" marker; main → version+hash, other branches → branch+hash+commit time + amber preview-DB warning via isPreviewBuild(); values injected by vite define)
│   ├── debugConsole.ts    # ★ On-screen debug console (`?dbg=true`): pure flag-parse + log ring-buffer + console/global-error capture (mobile/PWA has no dev tools) — rendered by components/DebugConsole.tsx
│   ├── units.ts           # ★ Pure unit conversions + display formatters for the 3 imperial/metric toggles (speed/distance/weather) — single home for every conversion constant
│   └── utils.ts           # Tailwind cn() helper
├── plugins/               # ★ Plugin framework (auto-discovered) — see Plugin Framework section
│   ├── (framework)        # types, registry, index, panels, mounts, storage + PluginPanelHost/PluginMount
│   ├── cloud-sync/         # ★ First-party plugin: Supabase file + garage sync — see docs/backend.md
│   ├── tools/              # ★ First-party plugin: Tools tab (lazy tool picker; kart seat-position
│   │                      #   visualizer — pure rigid-body model.ts + SVG view, corner-scale calibration)
│   └── coaching/           # Gitignored slot for the AI coach (npm pkg in production)
├── types/racing.ts        # ★ Core types: GpsSample, ParsedData, Lap, Course, Track, …
├── contexts/              # SettingsContext, SessionContext, PlaybackContext, DeviceContext (BLE), AuthContext (admin)
│                          # ★ PlaybackContext carries ONLY the playback cursor (currentIndex/currentSample).
│                          #   It updates at playback rate, so it's split from SessionContext to keep the
│                          #   memo'd tabs quiet during playback. Never put the cursor — or anything that
│                          #   churns per tick — into SessionContext; its value must stay referentially
│                          #   stable while playing (useVideoSync memoizes state/actions for this reason).
│                          #   Charts draw on two stacked canvases: a static layer + a cursor overlay.
└── integrations/supabase/ # Auto-generated — DO NOT EDIT
```

---

## Data Flow Pipeline

```
File Import (drag-drop / BLE download / file manager)
  → fileStorage.ts (save raw blob to IndexedDB)
  → useSessionData.ts (read blob, call parseDatalogFile)
    → datalogParser.ts (auto-detect format, route to specific parser)
      → normalizeChannels() (channels.ts): rewrites every fieldMapping name + extraFields key to a canonical ChannelId (or `custom:` slug), sets display label/unit. Runs once for all formats — parsers keep emitting human names internally.
      → returns ParsedData { samples: GpsSample[], fieldMappings, bounds, duration, startDate, dovexMetadata?, parserStats? }
  → courseDetection.ts (auto-detect track, course, direction; waypoint fallback)
    → returns CourseDetectionResult { track, course, direction, laps, isWaypointMode }
  → useLapManagement.ts (detect laps via lapCalculation.ts using selected course's start/finish line)
    → returns Lap[] with timing, speed stats, sector times
  → Visualization:
      Simple mode: RaceLineView (Leaflet map) + TelemetryChart (Canvas)
      Pro mode: GraphViewPanel (multi-series Canvas charts) + MiniMap (Leaflet)
```

---

## Plugin Framework (`src/plugins/`)

Modular extension system. The open-source app defines the contract; plugins
implement `DataViewerPlugin` and are discovered from **two sources** at startup:
1. In-repo first-party plugins — `src/plugins/<name>/index.ts` via `import.meta.glob`.
2. External npm packages (the AI coach) — via the `virtual:external-plugins`
   module generated by `externalPluginsLoader` in `vite.config.ts`.
A plugin absent at build time simply never loads — the app builds/runs without it.

| File | Purpose |
|------|---------|
| `types.ts` | `DataViewerPlugin` (incl. `priority`), `PluginContext`, `PluginRegistry` contracts |
| `registry.ts` | Singleton registry: `register`/`get`/`list` + generic `contribute`/`getContributions`. Same-`id` plugins resolve by highest `priority` |
| `index.ts` | `initPlugins()` — glob + external discovery, runs each plugin's `setup(ctx)`. Called once in `main.tsx` before render |
| `external-plugins.d.ts` | Ambient type for the `virtual:external-plugins` module |
| `panels.ts` | **UI panel framework**: `PluginPanel` / `PluginPanelProps` contract, `PANELS_POINT`, `PanelSlot`, `getPanelsForSlot(slot)`. The curated session snapshot is the entire surface a panel can rely on — incl. `sessionSetup` (the current session's assigned setup) + `activeSnapshot` (`PluginSnapshot`: the loaded reference lap snapshot with clean-lap samples + frozen engine/course/vehicle/setup), so a coach panel can compare the current setup against the frozen snapshot setup |
| `PluginPanelHost.tsx` | Consumer: mounts every panel for a slot in a titled card, each wrapped in a per-panel error boundary; renders a `fallback` when none. A `chromeless` panel skips the card chrome (full-bleed); an all-chromeless slot (`isBareSlot`) drops the host's outer padding so one panel fills the tab |
| `mounts.ts` | **Inline mount framework**: `PluginMountDef`, `MOUNTS_POINT`, `MountSlot` (`FileRow`, `FileDeleteConfirm`), per-slot context types, `getMounts(slot)`. For injecting raw components into fixed spots in core UI |
| `fileSources.ts` | **File-source framework**: `FILE_SOURCES_POINT`, `FileSource` (`listFiles`/`download`), `useFileSources()`. Lets a plugin feed *remote* (cloud) files into the host browser as inline `cloud` rows — host stays cloud-agnostic |
| `PluginMount.tsx` | Consumer: `<PluginMount slot ctx>` renders every mount for a slot (error-boundaried + Suspense), or nothing when none — safe to drop into core UI unconditionally |
| `storage.ts` | `getPluginStore(id)`: schema-less KV scoped to one plugin, in its own IndexedDB DB (`dove-plugin-<id>`). Decoupled from core `dbUtils`. Also exposed as `ctx.storage` |
| `coaching/` | **Gitignored** local-dev slot for the coach plugin (production loads it as an npm package) |

A plugin default-exports `{ id, name, version?, priority?, setup?(ctx) }`. In
`setup`, it contributes to named extension points
(`ctx.registry.contribute(point, value)`); consumers read via
`getContributions(point)`. New extension points need no registry changes.
`ctx.storage` is a `PluginStore` (per-plugin KV) for persisting plugin state.

**UI panels:** the first concrete extension point. A plugin contributes
`PluginPanel` descriptors to `PANELS_POINT`, targeting a *slot* (host surface).
Four slots exist today: `PanelSlot.Labs` (rendered by `LabsTab.tsx`; no
first-party panel targets it now — it shows only when the experimental
`enableLabs` setting is on or another plugin contributes), `PanelSlot.Coach`
(rendered by `CoachTab.tsx` — the dedicated AI Coach tab, home for the
`@perchwerks/eye-in-the-sky` coaching plugin), `PanelSlot.Tools`
(rendered by `ToolsTab.tsx` — the Tools tab right of Coach; the first-party
`tools` plugin contributes its chromeless tool-picker panel there), and
`PanelSlot.Profile`
(rendered by `ProfileTab.tsx` — mounted as a tab **inside the file-manager
drawer**, between Garage and Device, not in the main view tab bar; cloud-sync
contributes the merged Account panel (sign-in/out + display name + plan +
storage, working signed out against local storage), lap-snapshot management, and
cloud-log management). All render contributed
panels via `PluginPanelHost` and are
**self-gating**: `Index.tsx` computes `hasLabsPanels`/`showCoach`/`showTools`/
`showProfile` from `getPanelsForSlot`, so a tab appears only when a
plugin contributes a panel to it (Labs additionally shows when the experimental
`enableLabs` setting is on). New slots are just new strings — no framework change.
`PluginPanelHost` wraps each panel in an error boundary **and** a `Suspense`
boundary, so panel components can be `React.lazy` (as `cloud-sync` is). A panel
may set `chromeless: true` to render its body without the host's card/header/
padding — for panels that own their full layout (e.g. a full-bleed coach
dashboard); the error boundary + Suspense still apply, and a slot whose panels
are all chromeless (`isBareSlot`) also drops the host's outer padding.

**Inline mounts:** where panels are standalone cards, *mounts* inject a raw
component into a fixed spot in core UI. A plugin contributes a `PluginMountDef`
to `MOUNTS_POINT`, targeting a `MountSlot`; the host renders `<PluginMount slot
ctx={…}>` at that spot, passing a typed context as a single `ctx` prop.
`FilesTab` exposes two: `MountSlot.FileRow` (per *local* file row, ctx = that
file + metadata — cloud-sync's per-file sync toggle) and
`MountSlot.FileDeleteConfirm` (inside the delete-confirm banner, ctx = the target
file + a `registerOnConfirm` hook so a plugin can run an extra action — e.g.
cloud-sync's "also delete the cloud copy" — without the host knowing about
cloud). New mount locations are just new slot strings.

**File sources (`fileSources.ts`, `FILE_SOURCES_POINT`):** the seam that puts
*cloud* files inline in the browser without coupling the host to cloud. A plugin
contributes a `FileSource` (`{ id, listFiles(): Promise<RemoteFile[]>,
download(name): Promise<Blob|null> }`); `FilesTab` merges the listed files into
the same Track→Course tree as **`location: "cloud"`** rows (deduped against local,
local wins), and a one-tap on a cloud row calls `download` → `onSaveFile` →
opens it. cloud-sync's source dynamic-imports `syncEngine` so Supabase stays off
the initial bundle, and returns `[]` when signed out/offline. The shared
**`SessionBrowser`** component (`src/components/SessionBrowser.tsx`) renders any
`BrowserView` (breadcrumb + folders + caller-rendered rows) — used by both
`FilesTab` and the Profile **Cloud logs** panel.

**Cloud Sync (first-party plugin, `src/plugins/cloud-sync/`):** the first
in-repo plugin built on the panel framework — contributes the merged **Account**
panel (`StoragePanel`, `PanelSlot.Profile`, ordered first — sign-in/out, display
name, plan, and the storage bar, which falls back to `localUsage.ts` when signed
out to show this device's local usage), the lap-snapshots + cloud-logs panels
(the **Cloud logs** panel renders the same Track→Course `SessionBrowser` and hosts
the "Download all cloud logs" bulk action), the per-file sync-toggle mount, and a
**file source** that surfaces cloud-only logs inline in the file browser.
Syncing is automatic (no manual push/pull) — `autoSync` drives
the incremental engine. Backs the IndexedDB stores up to Supabase: structured
stores → `sync_records` jsonb docs, raw blobs → the private `user-files` bucket.
**Full data model, sync engine, conflict resolution, and backend live in
`docs/backend.md`.**

**Tools (first-party plugin, `src/plugins/tools/`):** contributes one chromeless
panel to `PanelSlot.Tools`: a picker of trackside tools (icon + one-line
description, catalog in `toolList.ts`) that opens the selected tool with a back
bar. Everything is lazy (`ToolsPanel` and each tool component), so nothing rides
the initial bundle, and fully offline. Tool state persists via
`getPluginStore("tools")`. First tool: the **kart seat position visualizer**
(`seat-position/`) — a pure, unit-tested rigid-body statics model (`model.ts`:
4-element mass model with a feet-on-pedals leg-coupling factor, slide + tilt
about the front anchor, closed-form + central-difference sensitivities, knee IK,
corner-scale calibration that fits `kLegs`, and `rebaseline()` for
"set current as zero") rendered as a side-view SVG (`SeatDiagram.tsx`) with
controls/readouts in `SeatPositionTool.tsx`. The user plans to split this plugin
into its own repo later — keep it free of deep host imports (it touches only the
plugin contracts + `components/ui`).

**AI coach (npm package):** published to the public npm registry as
`@perchwerks/eye-in-the-sky` and listed in `optionalDependencies`. The loader in
`vite.config.ts` defaults to that package (no token or `.npmrc` needed);
`DOVE_PLUGIN_PACKAGES` (build env var) overrides the candidate list when set.
The coach shares the public stub's `id` with a higher `priority` to override it.
See `src/plugins/README.md` for the full publish/wire workflow.

Offline-first note: plugins are bundled internal code. Only a plugin's runtime
network calls (e.g. AI model APIs) go online — the accepted compromise. Supabase
cloud is purely file-sync.

---

## Parser System

Each parser exports two functions:
- `isXxxFormat(input: string | ArrayBuffer): boolean` — format detection
- `parseXxxFile(input: string | ArrayBuffer): ParsedData` — full parse

**To add a new parser:**
1. Create `src/lib/xxxParser.ts` with `isXxxFormat()` + `parseXxxFile()`
2. Register in `src/lib/datalogParser.ts` — add import + detection check in both `parseDatalogFile()` and `parseDatalogContent()`
3. Update `README.md` supported formats table
4. Update this file's architecture map

Detection order matters: AiM XRK/XRZ first (binary, by extension/`<h` magic), then other binary formats (MoTeC LD → UBX → iRacing `.ibt`), then text formats from most-specific to least (VBO → MoTeC CSV → Dovex → Dove → Alfano → AiM CSV → NMEA fallback). The iRacing `.ibt` has no magic bytes, so it's detected by validating the irsdk header's internal consistency plus a `WeekendInfo` probe of the embedded session YAML (`isIracingFormat`).

### AiM XRK/XRZ (`src/lib/xrk/`) — the async exception (wasm)

AiM's native binary logs don't fit the sync `parseXxxFile` contract: they're
parsed by **libxrk's pure-Rust core compiled to WebAssembly** (no Pyodide/
Python), run in a Web Worker. Flow: `isXrkFile()` (extension or `<h` magic) →
`parseXrkFile(file, onProgress?)` → worker (`xrkWorker.ts`) instantiates the wasm
(`wasm/`, precached) once, calls `parse_xrk(bytes)` → pure `xrkResample.ts`
aligns native-rate channels onto the GPS timebase (interpolate vs forward-fill
per channel) → transferable `Float64Array`s → pure `xrkMapping.ts` builds
`ParsedData` (then the router's `normalizeChannels` canonicalises it). Key facts:

- **Parsing is async only** (worker), so it's reached via `parseDatalogFile()`.
  Every "load a file" path uses that: FileImport, reopen from FilesTab, **and the
  reference/overlay loaders** (`useReferenceLap`/`useLapOverlays` parse saved
  files via `parseDatalogFile(new File([blob], name))`, cached per file). So XRK
  works as main session, reference, and overlay. Snapshots use the loaded
  session's samples, so they work too. The sync `parseDatalogContent()` still
  throws for XRK as a safety net — its only callers (BLE, bundled sample) are
  never XRK.
- **Fully offline + fast.** The ~200 KB wasm is **precached** (`wasm` is in the
  SW `globPatterns`); no network, no runtime download. Typical parse is tens to a
  couple hundred ms.
- **Built from source, committed.** `xrk-wasm/` is a thin `wasm-bindgen` wrapper
  crate over libxrk's core, pinned to a libxrk `rev` in its `Cargo.toml`.
  `scripts/build-xrk-wasm.sh` builds it → commits `src/lib/xrk/wasm/`
  (`xrk_wasm.js` glue + `xrk_wasm_bg.wasm`). CI is JS-only and never builds Rust.
  Licenses: `src/lib/xrk/wasm/THIRD-PARTY-NOTICES.txt`.
- `onProgress` is threaded `parseDatalogFile` → router → `parseXrkFile` (XRK
  only); other formats ignore it.

### iRacing `.ibt` (`src/lib/iracingParser.ts`) — the sim's native export

iRacing's only on-disk telemetry export is the binary `.ibt` (iRacing Binary
Telemetry) the sim writes at the session tick rate (typically 60 Hz) once
logging is armed (Alt-L / always-on setting) — the same data the live
shared-memory **irsdk** API serves. There is no built-in CSV/MoTeC export; those
are all third-party conversions of this file, so the parser reads `.ibt`
**directly** (synchronous, pure JS `DataView`, fully offline — fits the normal
`isXxxFormat`/`parseXxxFile` contract, unlike XRK). Layout (little-endian, per
irsdk `irsdk_defines.h`): a 112-byte `irsdk_header` → a 32-byte
`irsdk_diskSubHeader` (only in `.ibt`; carries `sessionStartDate` +
`sessionRecordCount`) → the session-info **YAML** string → `varHeader[numVars]`
(144 bytes each: type, in-row byte offset, name/desc/unit) → fixed-stride data
rows (`sessionRecordCount` × `bufLen`, channel value at `rowBase + varHeader.offset`,
decoded by `irsdk_VarType`). GPS `Lat`/`Lon` (degrees) + `Speed` (m/s) + `Alt`
make it a first-class GPS source; `SessionTime` is the timebase. Driver inputs
(throttle/brake/clutch → %, gear, steering → °), engine (RPM, water/oil temp),
and **native** lateral/longitudinal g (`LatAccel`/`LongAccel` → `lat_g_native`/
`lon_g_native`, coexisting with the GPS-derived `lat_g`/`lon_g`) ride along in
`extraFields` under human names that `normalizeChannels` canonicalises.

---

## Core Types (`src/types/racing.ts`)

| Type | Key Fields |
|------|------------|
| `GpsSample` | `t` (ms), `lat`, `lon`, `speedMps/Mph/Kph`, `heading?`, `extraFields: Record<string,number>` |
| `ParsedData` | `samples[]`, `fieldMappings[]`, `bounds`, `duration`, `startDate?`, `dovexMetadata?`, `parserStats?` |
| `ParserStats` | `totalRows`, `acceptedRows`, `rejected: { nanFields, zeroCoords, outOfRange, speedCap, teleportation, incompleteRow }` |
| `DovexMetadata` | `datetime?`, `driver?`, `course?`, `shortName?`, `bestLapMs?`, `optimalMs?`, `lapTimesMs?[]` |
| `Lap` | `lapNumber`, `startTime/endTime`, `lapTimeMs`, speed stats, `startIndex/endIndex`, `sectors?` (S1/S2/S3 **major rollup**), `sectorTimes?` (fine-grained per-segment), `sectorBoundaries?` (per-line sample indices) |
| `Course` | `name`, `lengthFt?`, `startFinishA/B` (lat/lon), `sectors?: CourseSector[]` (ordered timing lines after S/F), deprecated `sector2/sector3` (legacy mirror of the 2 majors, kept in sync by `normalizeCourseSectors`), optional `layout?` (`{lat,lon}[]` user-drawn outline) |
| `CourseSector` | `{ line: SectorLine, major: boolean }` — one timing line after start/finish (the implicit, always-major sector 1) |
| `Track` | `name`, `shortName?` (max 8 chars), `courses[]` |
| `CourseDetectionResult` | `track`, `course`, `direction?`, `laps[]`, `isWaypointMode`, `waypointNotice?` |
| `CourseDirection` | `'forward' \| 'reverse'` |
| `FieldMapping` | `index`, `name` (canonical ChannelId or `custom:` slug — the extraFields key), `label?` (display), `unit?`, `enabled` |
| `FileMetadata` | `fileName`, `trackName`, `courseName`, `weatherStation*?`, `sessionKartId?`, `sessionSetupId?` (live setup), `sessionSetupRev?` (frozen setup-revision content hash), `sessionEngine?` (engine snapshot for browser grouping), `sessionStartTime?` (first-sample epoch ms → browser display name), `fastestLapMs?`, `fastestLapNumber?`. Partial updates go through `updateFileMetadata(fileName, patch)` (read-merge-write — never clobbers untouched tags). |

---

## Automatic Course Detection (`src/lib/courseDetection.ts`)

When a file is loaded and no track/course is saved in metadata, the system auto-detects:

1. **Track discovery**: Find first valid GPS sample within **5 miles** (~8047m) of any known track
2. **Course matching**: Try each course's S/F line → calculate laps → compare average lap distance (ft) to course `lengthFt` → pick closest match within 25% tolerance
3. **Direction detection**: After S/F crossing, check which sector is crossed first — Sector 2 = forward, Sector 3 = reverse. Only works on courses with known sector lines.
4. **Waypoint mode fallback**: If no track matches or no course produces valid laps:
   - Drop a waypoint at the first sample where speed ≥ 30 MPH
   - Track returns to waypoint (within 30m after traveling 100m+) for rough lap timing
   - Divide lap distance by 3 for approximate sector boundaries
   - Show notice: "Waypoint timing — lower accuracy. Create a track for precise timing."

---

## .dovex Format (`src/lib/dovexParser.ts`)

Extended Dove format with an 8192-byte (8 KB) metadata header:
```
Line 1: datetime,driver,course,short_name,best_lap_ms,optimal_ms
Line 2: 2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200
Line 3: lap_times_ms
Line 4: 65432,64321,62345,63456   (lap times in ms, comma-separated)
\n padding to byte 8192
Byte 8192+: standard .dove CSV (timestamp,sats,hdop,lat,lng,...)
```

GPS data is always parseable even if metadata is corrupted. Metadata is attached as `ParsedData.dovexMetadata`.

---

## IndexedDB Storage (`src/lib/dbUtils.ts`)

Single shared database: `"dove-file-manager"`, version 12.

| Store | Key | Module |
|-------|-----|--------|
| `files` | `name` | `fileStorage.ts` |
| `metadata` | `fileName` | `fileStorage.ts` |
| `karts` | `id` | `kartStorage.ts` |
| `notes` | `id` (indexed by `fileName`) | `noteStorage.ts` |
| `setups` | `id` (indexed by `kartId`) | `setupStorage.ts` |
| `video-sync` | `sessionFileName` | `videoStorage.ts` |
| `graph-prefs` | `sessionFileName` | `graphPrefsStorage.ts` |
| `vehicle-types` | `id` | `templateStorage.ts` |
| `setup-templates` | `id` | `templateStorage.ts` |
| `session-videos` | `sessionFileName` | `videoFileStorage.ts` |
| `engines` | `id` | `engineStorage.ts` |
| `lap-snapshots` | `id` (indexed by `courseKey`, `engineKey`) | `lapSnapshotStorage.ts` |
| `setup-revisions` | `id` = content hash (indexed by `setupId`) | `setupRevisionStorage.ts` |

To add a new store: increment `DB_VERSION`, add store name to `STORE_NAMES`, add creation logic in `openDB()`, create a corresponding storage module.

---

## Lap Snapshots (`src/lib/lapSnapshot.ts` + `lapSnapshotStorage.ts`)

Frozen "course fastest lap" captures — an immutable single-lap baseline for
cross-session comparison (and future AI coaching).

- **Identity = (course + engine).** Engine is the layman's "primary key"; the
  chassis travels inside the frozen `setup`. Exactly one snapshot per pair — a
  faster lap upserts in place (same deterministic `id`). `engine` is the free-text
  `Vehicle.engine` string, matched via `engineKey` (trimmed + lowercased).
- **What's frozen:** the lap's GPS samples **± a 5s buffer** on each side (so a
  later start/finish nudge still fits), `lapStartMs`/`lapEndMs` markers, the
  `Course` geometry, lap time, source file/lap, and a copy of the vehicle/setup.
  `snapshotLapSamples()` trims the buffer back to the clean lap for overlay.
- **Capture triggers:** assigning an engine + setup to a log prompts
  (`LapSnapshotPromptDialog`) when its best lap beats (or has no) stored
  snapshot; a manual "Save as snapshot" lives in `LapSnapshotControls` (the
  lap-list **Snapshots** picker, in the header so it serves simple + pro mode).
  Orchestrated by `useLapSnapshots`.
- **Loaded as a comparison overlay only.** Selecting a snapshot feeds its clean
  samples into the **external-reference slot** (`externalRefSamples`), so it
  renders like a reference lap and is **excluded from playback + the video
  player** — it is never an appended lap. Engine is shown in the overlay label.
- **Sync (cloud-sync plugin):** a **dedicated `lap_snapshots` table**, but its
  serialized payload size counts toward the **same unified per-tier byte budget**
  as documents + logs (`subscription_tiers.total_bytes`), enforced by a trigger —
  no separate count quota. Always pushes on save; a local delete **never**
  propagates to the cloud (the cloud copy is removed only explicitly from
  **Profile → Lap snapshots**, like the log menu). Cloud deletes are tombstoned
  (`snapshotTombstones.ts`) so reconcile won't resurrect a surviving local copy.
  `reconcileSnapshots()` pulls cloud→local additively and pushes local-only up.
  Local storage is always unlimited.

---

## Setup Revisions (`src/lib/setupRevision.ts` + `setupRevisionStorage.ts`)

Immutable, **content-addressed** history of vehicle setups — git's blob model
without the diff chains. A `VehicleSetup` (`setups` store) is the *live, editable*
working copy; a `SetupRevision` (`setup-revisions` store) is a write-once frozen
copy whose **`id` is a SHA-256 of its content**. This keeps a session's setup
exactly as it was the day it ran, even after the live setup is later edited.

- **Freeze on assignment.** `handleSaveSessionSetup` (`useSessionMetadata`) calls
  `freezeSetupRevision(setupId)`, which reads the live setup + its template, builds
  the revision (`buildSetupRevision`), and stores its hash on
  `FileMetadata.sessionSetupRev`. `sessionSetupId` (live pointer) is kept alongside
  for lineage / the future "edit the setup later" flow.
- **The hash is the identity.** `computeSetupHash(setup, template)` hashes a
  canonical (sorted-key) projection of the setup's values **+ the template
  structure**, excluding volatile bookkeeping (`id`/`createdAt`/`updatedAt`). So
  two sessions on the genuinely-identical setup dedup to the **same hash**, and any
  value change — *or* a template change (a renamed/added field) — yields a new
  hash, i.e. a new revision, with no child-type machinery. `freezeSetupRevision`
  is idempotent: an existing-hash revision is reused (original `createdAt` kept).
- **Self-contained.** A revision embeds a frozen copy of the `setup` **and** the
  template structure (`FrozenTemplate`: section + field names/units), so old
  history always renders with the labels it had that day.
- **Display.** `shortRevHash()` surfaces the leading 6 hex chars (git-style). The
  **SetupsTab** list shows each setup's current would-be hash; **NotesTab** shows
  the frozen `#hash` of the session's setup revision.
- **Orphan prune (GC).** A revision is an orphan once no `FileMetadata.sessionSetupRev`
  points at it. `pruneSetupRevisions()` deletes orphans (pure split:
  `findOrphanRevisionIds`); `maybePruneSetupRevisions()` throttles it to ~once every
  `PRUNE_INTERVAL_MS` (3 days) via a localStorage timestamp and is fired
  best-effort from `useSetupManager` on mount. Works fully offline.
- **Sync (cloud-sync plugin):** revisions ride the **generic garage-doc engine** —
  registered in `syncStores.ts` (`DOC_STORES` + `KEY_FIELD`, keyed by `id`), so
  they push/pull as ordinary `sync_records` rows counting toward the pooled
  documents budget. No dedicated table. Being immutable + content-addressed, the
  last-write-wins merge is a no-op on collision. **Prune is local-only:** a deleted
  orphan is **tombstoned** (`setupRevisionTombstones.ts`, per-user) rather than
  removed from the cloud — `autoSync` skips the cloud delete and the
  `setup-revisions` store accessor skips re-pulling a tombstoned id, so the sweep
  isn't undone by reconcile. A fresh freeze of the same content clears the
  tombstone. **Cloud-side GC and later-editing are deliberate follow-ups.**

---

## Cloud Sync, Subscriptions & GDPR — see `docs/backend.md`

These three subsystems are **Supabase-backed** and, per the offline-first rule
(#1), touch nothing in the core app. Their data models, RLS, triggers, edge
functions, and client wiring are documented in
**[`docs/backend.md`](docs/backend.md)** to keep this file focused. Read it
before working on:

- **Cloud Sync** (`src/plugins/cloud-sync/`) — per-user backup/sync of the
  IndexedDB garage + log blobs: auto-sync off `garageEvents`, conflict resolution
  (pending-wins + last-write-wins), the unified pooled byte quota, orphan-safety,
  and opt-in per-file logs.
- **Subscriptions / Stripe** — paid tiers that scale one pooled storage budget;
  tiers are data (`subscription_tiers.total_bytes`), prices resolve by Stripe
  lookup_key, and entitlements are written only by the webhook. Operator setup
  (Products/Prices, secrets, `pg_cron`) is in the README.
- **Data Rights & Retention / GDPR** — self-service export/erasure, the 7-day
  deletion window, and automatic IP minimisation.

Documents, logs, and lap snapshots all draw from **one pooled per-tier byte
budget** (`subscription_tiers.total_bytes`: free 50 MB / plus 10 GB / premium
100 GB / pro 500 GB), shown as a single segmented bar on the Profile tab — see
`docs/backend.md`.

---

## Course Sectors ("Unlimited" sectors — `lib/courseSectors.ts`)

A course's timing lines are **start/finish (the implicit, always-major sector 1)
+ an ordered `Course.sectors` list** (`{line, major}[]`). Exactly three are
"major" (start/finish + two flagged). Hidden caps: **25 timing lines**, **3
majors** — both named constants (`MAX_SECTOR_LINES`, `MAX_MAJOR_SECTORS`), raise
later. `courseSectors.ts` is the single source of truth; the rest of the app
never reasons about sector geometry directly.

- **One list, two visual groups.** The editor (`SectorListEditor`, dnd-kit
  reorderable) shows the ordered list below the map; a per-row **Major** switch
  flags the majors, sub-sectors indent under their owning major, drag order drives
  numbering (`sectorLabels`: `1, 1.1, 2, 2.1, 3`). Save is blocked unless there
  are 0 sectors or exactly 3 majors (`validateCourseSectors`). Three line colors
  on every map: S/F green, major purple, sub sky-blue.
- **The logger only ever sees the 3 majors.** `majorSectorLines`/`legacyMirror`
  project the course down to start/finish + `sector2`/`sector3` — **byte-identical**
  to the pre-overhaul device JSON, submission payload, and content hash.
  `normalizeCourseSectors` migrates legacy `sector2/3` → the array (and keeps the
  mirror in sync) at **every load boundary** (track load, device download, admin
  read). Sub-sectors are app-only.
- **Lap timing.** `calculateLaps` detects a crossing for every line → `Lap.sectorTimes[]`
  (one per segment) + `Lap.sectorBoundaries[]` (sample index per line) + `Lap.sectors`
  (the S1/S2/S3 **major rollup** via `rollupMajorSectors` — so video overlays,
  snapshots, and the coach plugin keep working unchanged: the **coach receives the
  major rollup only, for now**). `calculateOptimalLap` now sums the best time of
  **every** segment (the true ideal lap), excluded-segment → `null`.
- **Lap table** has a **Simple/Full** toggle (`LapTable.tsx`): Simple = S1/S2/S3,
  Full = one column per fine-grained sector, zebra-striped by major group,
  horizontally scrollable (shown only when sub-sectors exist). The per-lap "Map"
  overlay column was removed.
- **Crop-to-sector** (`SectorCropSelect`): the data-crop bar pairs the range
  slider (~80%) with a sector dropdown (~20%) that snaps `visibleRange` to a
  sector via `Lap.sectorBoundaries` (per-lap; disabled for all-laps view).
- **Persistence.** Track JSON + community submissions + the admin `courses`/
  `submissions` tables carry a canonical `sectors` / `sectors_data` array
  alongside the legacy mirror columns (migration
  `20260613000000_course_sectors_data.sql`; the generated Supabase types lag — the
  adapter builds the insert payload as a variable to dodge the excess-property
  check until regen). `submit-track` edge fn validates the optional `sectors`
  array (≤24, exactly-2-majors-or-none).

---

## Course Layouts (Drawing Feature)

The `course_layouts` table stores polyline drawings of track layouts (1:1 with courses, unique on `course_id`, cascade delete).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `course_id` | uuid FK → courses.id (unique) | One layout per course |
| `layout_data` | jsonb | Array of `{lat, lon}` coordinate points |
| `created_at` / `updated_at` | timestamptz | Timestamps |

**Access**: Admin-only RLS (same pattern as courses table). Layout lengths (in feet) ARE exported to track JSON files as `lengthFt`.

**Draw tool**: In the VisualEditor, a "Draw" button allows clicking on the satellite map to build a polyline outline. It is shown whenever `showDrawTool` is set — **available to all users**, not just admin (the old `isAdminEditor` gate was removed). User-drawn (or lap-generated) outlines are persisted on `Course.layout` (a `{lat, lon}[]` polyline) through the normal track-storage CRUD, so they ride cloud-sync and travel with a community submission. Built-in courses still get their outline from `public/drawings.json` (see `loadCourseDrawings`); when editing, the user's own `course.layout` takes precedence over the built-in drawing.

**Manage Tracks (home screen)**: `LandingPage` renders a **Manage Tracks** action tile that opens `TrackEditor` via its `triggerButton` + `startInManage` props — the track manager is reachable with no datalog loaded. The create-flow dialogs (`AddTrackDialog`/`AddCourseDialog`) pass `isNewTrack`/`showDrawTool` so location search + manual drawing are available there.

**Generate Drawing**: A "Generate" button (visible when `showDrawTool` is true and either laps *or* GPS samples are available) auto-populates the drawing from GPS data. With detected laps it opens a picker — each lap **plus** a **Whole session** option; with no laps (a fresh track at a brand-new venue where waypoint mode never closed a lap) it generates straight from the full session trace, so the outline can be drawn before a course exists. Available in user-side TrackEditor when session data is loaded. Laps and samples are threaded from `Index.tsx` → `TrackEditor` → `VisualEditor` (and into the create-flow dialogs). The drawing state lives in `useTrackEditorForm` (`formLayout`) and is written into the course via `buildCourse()`. The editor's satellite basemap shares the race-line map's Esri **Wayback** imagery-date picker (`useWaybackImagery`), so lines can be placed against a cloud-free capture (online-only, lazy).

When a track/course is created or edited while a session is loaded, `TrackEditor` immediately re-applies it via `onSelectionChange` (laps recompute, no file reload), and every `TrackEditor` instance refreshes its list off a `garageEvents` subscription on the `tracks` store so a new track appears in the selector without a page refresh.

**"Generate Course Mapping" button**: Placeholder in admin CoursesTab — will eventually produce fingerprint data for automatic track detection on the DovesDataLogger hardware.

**Submissions**: The `submissions` table has `has_layout` (bool) and `layout_data` (jsonb) columns to carry drawing data through the submission workflow. The client now sends a course's `layout` as `layout_data` (`SubmitTrackDialog` → `submit-track` edge fn, which validates point shape + caps at 5000 points), the drawing is folded into `courseContentHash` (so adding/editing a drawing re-flags the course for upload), and the admin **Submissions** tab previews the polyline (`DrawingPreview`) with an **Apply to course layout** action that matches the DB course (by short-name/name + course name) and calls `db.saveLayout`. `DbSubmission` carries `has_layout`/`layout_data`.

**Public drawings**: Admin exports drawings to `public/drawings.json` (keyed by `shortName/courseName` → `[{lat, lon}, ...]`). Loaded by `trackStorage.ts:loadCourseDrawings()` (cached). Rendered on the race line map as a dashed polyline outline when a course is selected. Helper: `getDrawingForCourse(shortName, courseName)`.

---

## Community Track Submission (`SubmitTrackDialog` + `lib/trackSubmission.ts`)

The "Submit to DB" flow (track editor) is a **bulk, form-free contribution**:
`buildSubmissionPlan(merged, defaults, submitted)` (pure, unit-tested) diffs the
user's local tracks against the built-in list (`loadDefaultTracks()`) and
classifies each user course as **new_track** (wholly new track —
`Track.isUserDefined`), **new_course** (a course added to a built-in track), or
**course_modification** (an edited built-in course). A user "edit" that is
byte-identical to the built-in course is skipped. The track-level rollup reads
**New** vs **Edited** (adding a course never overwrites the track). A geometry
**+ drawing content hash** (`courseContentHash`, rounded to ~1cm — now also folds
in the course's `layout` polyline) drives both the identical-skip and dedupe:
`submittedTracksStorage.ts` (localStorage key `racing-datalog-submitted-v1`)
remembers each submitted course's hash, so unchanged courses aren't re-sent and a
later edit — geometry *or* drawing — re-flags the course. A course's `layout`
rides the plan as `SubmissionCourse.layout` → `layout_data` in the payload.

The **"Submit to DB" button is always rendered** (in `TrackEditor`'s manage
view) and **disabled when nothing is pending** — `TrackEditor` runs
`buildSubmissionPlan` itself to compute `pendingSubmissionCount` for the
enable/label (and refreshes it via `onSubmitted`).

The review dialog sends all selected courses in **one** `submit-track` call
(`{ submissions: [...], turnstile_token }`); the edge function validates each,
caps batch size, rate-limits by rows/hour/IP, and inserts one `submissions` row
per course sharing a generated **`batch_id`** (migration
`20260603120000_submissions_batch_id.sql`). The admin **Submissions** tab groups
a batch together with **Approve all / Deny all**; each row is still reviewed/
approved individually (approval is still manual — it flips status; the admin then
builds/imports `tracks.json` as before). The single-submission body shape stays
supported for back-compat. `DbSubmission.batch_id` carries the group id client-
side (the generated Supabase types are untouched — `getSubmissions` casts).

---

## BLE Integration (`src/lib/ble/`)

Connects to **DovesLapTimer** (nRF52840) device via Web Bluetooth.

| UUID | Characteristic | Purpose |
|------|---------------|---------|
| `0x1820` | Service | Internet Protocol Support (container) |
| `0x2A3D` | File List | Read: newline-separated `filename,size` pairs |
| `0x2A3E` | File Request | Write: `GET:filename`, `LIST`, `SLIST`, `SGET:key`, `SSET:key=value`, `SRESET`, `TLIST`, `TGET:name`, `TPUT:name`, `TDEL:name`, `BATT` |
| `0x2A3F` | File Data | Notify: chunked file data (reassembled client-side) |
| `0x2A40` | File Status | Notify: `SIZE:n`, `DONE`, `ERROR:msg`, settings (`SVAL`, `SEND`, `SOK`, `SERR`), tracks (`TFILE`, `TEND`, `TREADY`, `TOK`, `TERR`), battery (`BATT:<pct>,<volt>`) |

### File Protocol
LIST → select file → GET:filename → receive SIZE → stream data chunks → DONE.

### Settings Protocol
- `SLIST` → device sends `SVAL:key=value` for each setting on fileStatus, ends with `SEND`
- `SGET:key` → device responds `SVAL:key=value` or `SERR:NOT_FOUND` on fileStatus
- `SSET:key=value` → device responds `SOK:key` or `SERR:WRITE_FAIL` on fileStatus
- `SRESET` → device responds `SOK:RESET` on fileStatus, then reboots. App should disconnect immediately after receiving confirmation.

### Track File Protocol
- `TLIST` → device sends `TFILE:name.json` per file on fileStatus, ends with `TEND`
- `TGET:name.json` → reuses existing SIZE → data chunks (fileData) → DONE (fileStatus) transfer pattern
- `TPUT:name.json` → device responds `TREADY` on fileStatus → app sends data chunks on fileRequest (64-byte max) → `TDONE` → device responds `TOK` or `TERR:reason`
- `TDEL:name.json` → device responds `TOK` on fileStatus (success) or `TERR:reason` (failure). 10s timeout.

### Battery Protocol
- `BATT` → device responds `BATT:<percent>,<voltage>` on fileStatus (e.g., `BATT:85,3.98`). 5s timeout.

Settings schema is defined in `src/lib/deviceSettingsSchema.ts` — maps keys to labels, types, and validation rules. Unknown keys from the device are displayed as raw string fields (forward-compatible).

### Firmware update over BLE — SD-staged OTA (`src/lib/ble/dfu/` + `firmware*.ts`)

The logger (Seeed XIAO nRF52840, Adafruit nRF52 core) is updated in-app over Web
Bluetooth. **Legacy/Secure BLE DFU is impossible from a browser** — Chrome's Web
Bluetooth blocklist bans the Nordic legacy DFU service, and a Secure-DFU
bootloader needs SWD pins (sealed units). So instead the image is **staged on the
device's SD card over the existing `0x1820` file service** (not blocklisted), the
device verifies it by CRC and installs it itself. Full design + the firmware
contract in
[`docs/plans/firmware-sdcard-ota.md`](docs/plans/firmware-sdcard-ota.md).
(The original BLE-DFU investigation — and why it's dead — is in
[`docs/plans/firmware-bluetooth-dfu.md`](docs/plans/firmware-bluetooth-dfu.md).)

- **Check version** — read the standard **Device Information Service** (`0x180A`):
  Firmware Revision (`0x2A26`) → version, Model Number (`0x2A24`,
  `"BirdsEye-<variant>"`) → variant (which selects the manifest build).
  `dfu/version.ts`; `0x180A` is in `connectToDevice()`'s `optionalServices`.
- **Manifest** — `dfu/firmwareManifest.ts`: fetch the online OTA index via
  `getManifestUrl()` — `VITE_FIRMWARE_MANIFEST_URL` override > the **beta channel**
  (`.../DovesDataLogger/beta/manifest.json`) on non-`main`/preview builds
  (`isPreviewBuild()`) > production (`.../DovesDataLogger/manifest.json`) — + pure
  `compareVersions`/`isUpdateAvailable`/`pickBuildForVariant`/
  `evaluateFirmwareUpdate`. Each build carries `appBin`
  (raw `.bin` URL) + `appCrc32` + `appSize`; `assertImageMatchesBuild` verifies a
  download against them (the **first link of the full-circle CRC chain**, pure).
  Online-only.
- **Package** — `dfu/dfuPackage.ts`: `jszip` unzip of a `dfuZip` → `{ image
  (.bin), … }`. Only the **fallback** path now (older manifests without `appBin`);
  the normal flow downloads the raw `appBin` directly. The SD-staged flow uploads
  the `image`.
- **CRC** — `ble/firmwareCrc.ts`: `crc32`/`crc32Hex` (CRC-32/IEEE, known-vector
  tested so it matches the firmware byte-for-byte).
- **Transfer protocol** — `ble/firmwareUpload.ts` over `0x2A3E`/`0x2A40`, the
  paranoid handshake: `beginFirmwareUpdate` (`FWBEGIN:<size>,<crc>,<variant>`→
  `FWCRC` echo, abort on mismatch; device rejects a wrong variant here with
  `FWERR:VARIANT`) → `uploadFirmwareImage` (`FWPUT`→`FWREADY`→chunks→`FWDONE`→
  on-device verify `FWOK`/`FWERR`) → `applyFirmware` (`FWAPPLY`→`FWSTAGE`→
  `FWAPPLIED`). Upload uses a per-chunk watchdog (no total-time cap). Mock-BLE
  tested.

UI lives at the **top of the Device → Settings tab**
(`drawer/FirmwareUpdateSection.tsx`): installed version + a **Check for updates**
button → confirm dialog (battery warnings) → progress (download → upload →
verify → install) → auto-disconnect. Orchestrated by
`hooks/useFirmwareUpdate.ts`; the install is marked on `DeviceContext`
(`isFlashing`/`setFlashing`) so the expected BLE drop when the device reboots into
the new firmware doesn't tear down the UI mid-update.

On **beta/preview builds** (`isPreviewBuild()`, i.e. any non-`main` branch — same
switch as the footer/preview-DB), `evaluateFirmwareUpdate(…, { force: true })`
**bypasses the version check** so a matching build is always offered (testers can
re-flash the same/older version); the confirm dialog shows an amber "on beta
branches updates always push through for testing" note.

---

## Device Track Sync (`src/lib/deviceTrackSync.ts`)

Pure comparison/conversion logic for merging app tracks with device track files:
- `buildMergedTrackList()` — matches tracks by shortName, courses by name, classifies as synced/mismatch/device_only/app_only
- `coursesMatch()` — coordinate comparison with epsilon (0.0000005°)
- `buildTrackJsonForUpload()` — serializes app Track to device JSON format (flat course array, includes `lengthFt`)
- `deviceCourseToAppCourse()` / `appCourseToDeviceJson()` — format converters (both include `lengthFt`)
- `DeviceCourseJson` includes `lengthFt?: number` for hardware course detection by lap distance

---

## File Browser (`FilesTab.tsx` + `lib/fileBrowserTree.ts` + `components/SessionBrowser.tsx`)

The Garage → **Files** tab is a folder hierarchy, not a flat list: **Track → Course
→ logs**, with an optional **Engine/Kart** grouping on the final list. All the tree
+ navigation math is pure in `fileBrowserTree.ts` (unit-tested); the reusable
presentational **`SessionBrowser`** renders the computed `BrowserView` (breadcrumb
+ folders + caller-rendered rows). `FilesTab` owns the local row chrome; the
Profile **Cloud logs** panel reuses `SessionBrowser` with its own rows.

- **Display name = the session's date/time**, derived from `sessionStartTime` (the
  first valid sample), e.g. "2/12/2026 11:15 AM" — *not* the upload time or raw
  filename (filename is the row's `title`/tooltip + the stable IndexedDB key).
- **Log type bubble:** each row shows a `FileTypeBadge` (`components/FileTypeBadge.tsx`)
  with the format derived from the file extension (`lib/logFileType.ts`, pure +
  unit-tested) — the format isn't persisted, so the extension is the source of
  truth. Used on FilesTab local + cloud rows and the Profile Cloud logs panel.
- **Smart collapse:** a folder level is only rendered when there's more than one
  entry — a single track and/or single course auto-descends straight to the logs
  (the breadcrumb still records the collapsed segments so date names read in
  context). The explicit Engine/Kart filter, by contrast, **always** shows its
  folder(s); logs with no engine/kart sit loose **below** the filter folders.
- **Untagged bucket:** logs missing a track/course land in an "Untagged" folder
  after the real tracks (collapsing to a flat list when it's the only group).
- **Opens at the current session.** `Index.tsx` passes the loaded session's
  `currentTrackName`/`currentCourseName`; `FilesTab` re-homes there (`defaultNav`)
  on every drawer open and whenever a different session loads.
- **Grouping data** rides `FileMetadata`: `sessionEngine` (snapshotted from the
  kart at assign time, so grouping survives vehicle edits), `sessionKartId`
  (→ vehicle name), and `sessionStartTime`. Engine resolves to the snapshot first,
  then the live `Vehicle.engine`.
- **Cloud files appear inline.** Plugins contribute remote files via a
  `FileSource` (`FILE_SOURCES_POINT`); `buildBrowserSessions` merges them as
  `location: "cloud"` rows (deduped against local — local wins), and their
  metadata is read from the locally-synced `metadata` store (it pulls down even
  when the blob doesn't). A cloud row is a one-tap **download → save → open**. No
  separate "Cloud files" section — the offline-first host stays cloud-agnostic.

---

## Device Manager

The slide-out drawer (`FileManagerDrawer.tsx`) opens at half the viewport width
(`w-1/2`, both mobile and desktop) and has three top-level tabs:
- **Garage** — Files, Karts, Setups, Notes (original functionality)
- **Profile** — User account, storage, lap snapshots, data export. Renders the
  `PanelSlot.Profile` plugin panels via `ProfileTab`; only shown when a plugin
  (cloud-sync) contributes Profile panels (`showProfile` prop, computed in
  `Index.tsx`). Sits between Garage and Device. `ProfileTab` reads session +
  settings via the *optional* context hooks (`useOptionalSessionContext` /
  `useOptionalSettingsContext`) so it also renders from the landing-page drawer
  before any session is loaded.
- **Device** — BLE device management, gated behind a "Connect to Logger" prompt

Device sub-tabs:
- **Settings** — Read/write device settings via SLIST/SGET/SSET protocol
- **Tracks** — Full track sync manager: downloads all device track JSONs, merges with app tracks, shows sync status per track/course, supports upload/download/diff with side-by-side comparison modal

Global BLE connection state is managed by `DeviceContext.tsx`, wrapping the app tree in `Index.tsx`.

---

## Settings

`useSettings` hook (persists to localStorage) → `SettingsContext` for tree-wide access.

Key settings: `useKph`, `gForceSmoothing`, `gForceSmoothingStrength`, `brakingZoneSettings` (thresholds, duration, smoothing, color, width), `enableLabs` (hidden when no labs features), `darkMode`, `deltaMethod` (`'position'` default | `'distance'` legacy), `deltaSampleMeters` (arc-length resample spacing for position delta, default 2), `chartXAxis` (`'distance'` default | `'time'`) — the analysis-chart X-axis scale.

**Units are three independent imperial/metric toggles** (all default imperial), one per measurement family, each a Switch in `SettingsModal`:
- `useKph` (speed) — MPH ⇄ KPH. Picks `speedMph`/`speedKph` on every sample + speed axis labels.
- `useMetricDistance` (distance) — ft/mi ⇄ m/km. Drives the chart distance axis (`buildChartAxis` `opts.useMetricDistance`), the range-crop labels, `TrackEditor` course lengths, and the meters-based **distance-family telemetry channels** (`distance`, `altitude` — `isDistanceUnitChannel`; converted to a single continuous m/ft unit in the graph charts + video overlays. GPS accuracy `h_acc`/`v_acc` stays in meters).
- `useMetricWeather` (weather) — °F/mph/inHg/ft ⇄ °C/(km/h)/hPa/m. Drives `WeatherPanel` + `LocalWeatherDialog` (temp, dew point, wind, pressure, density/pressure altitude).

All conversions + display formatters live in **`lib/units.ts`** (pure, unit-tested in `units.test.ts`): canonical internal values (distance→meters, temp→Celsius, wind→knots, pressure→inHg, altitude→feet) convert only at display time. `chartAxis.formatAxisDistance` is a re-export of `units.formatDistance`. Weather/track-length surfaces read the flag via `useOptionalSettingsContext()` so they also render outside the provider (landing page).

`useReferenceLap.ts` routes pace through `computeLapPace` (`lapDelta.ts`), which
switches on `deltaMethod`. The position method is the issue #29 port; `distance`
falls back to the legacy `calculatePace` in `referenceUtils.ts`.

`chartXAxis` is plumbed through `SettingsContext` and consumed by both analysis
charts (`TelemetryChart`, `SingleSeriesChart`) via `lib/chartAxis.ts`
(`buildChartAxis`): a pure, unit-tested helper that maps each sample to an
x-fraction (elapsed-time fraction, or cumulative-distance fraction via
`calculateDistanceArray`), supplies tick labels (distance unit follows
`useMetricDistance`: imperial→ft/mi, metric→m/km), and an `indexAt` inverse for scrubbing. Distance is the
default so laps line up by track position; the reference/pace overlays already
align by distance, so they sit correctly on either axis.

The axis is **anchored at the start-finish line**: the charts draw the cropped
visible window stretched to fill the canvas (zoom preserved), but pass the full
lap (`allSamples`) + the window's `rangeStart` so `buildChartAxis` labels ticks
in *absolute* distance/time from the lap origin (`0` = start-finish) rather than
window-relative. The range-slider crop handles (`formatRangeLabel`, built in
`Index.tsx`) follow the same scale — cumulative distance from the lap start in
distance mode, elapsed time otherwise.

The **G-G diagram** (friction circle) is a pro-mode graph
(`graphview/GGDiagram.tsx`) added from the `GraphPanel` picker as the `__gg__`
key. It scatters lateral vs longitudinal G (lat on X, accel-positive lon on Y)
for the visible window, overlays the reference lap's cloud and the live scrub
point, and draws concentric 0.5 g grip rings. The data prep is pure + unit-tested
in `lib/ggDiagram.ts` (`pickGForcePair` honoring `gForceSource` → GPS `lat_g`/
`lon_g` or native `lat_g_native`/`lon_g_native`; `computeGGPoints` with per-axis
smoothing; `computeGGAxisMax` for the symmetric, clamped axis range). Raw IMU
`accel_*` is intentionally excluded — it isn't guaranteed grip-frame-aligned.

The **multi-lap overlay** draws extra laps/snapshots across **all four data
views at once**: racing lines on both maps (`RaceLineView` + `MiniMap`) and
distance-aligned traces on both chart types (`TelemetryChart` speed +
`SingleSeriesChart` per-series), with per-lap values in the cursor tooltip.
Selection: per-lap (`LapTable` "Map" column), per-snapshot
(`LapSnapshotControls`), and laps from **other saved files** via the header
**`OverlaysMenu`** (load+parse on demand, cached in `useLapOverlays`). The
`OverlaysMenu` is a three-section dialog: **Current overlays** (each line
promotable to the comparison reference via `onSetOverlayReference` — the active
reference is highlighted by matching `referenceLapNumber`/`externalRefLabel` —
or removable), **Current session laps** (toggle this session's laps as overlays
without the lap list), and **Add from other logs** — the other sessions tagged
with the *current course*, listed by date/time (`filesTaggedWithCourse` in
`fileBrowserTree.ts`, never raw file names). It replaces the old "External Ref"
bar (`ExternalRefBar`), which is now hidden-but-kept behind
`SHOW_EXTERNAL_REF_BAR` in `LapTable`; references are still also set from the
per-row **Ref** buttons. Held as
stable ids (`lap:<n>` / `snap:<id>` / `file:<lap>\x1f<name>`) and resolved by the
pure, unit-tested `lib/lapOverlays.ts` (`resolveOverlayLines` → `OverlayLine[]`
with palette colors, external samples from a cache; `unionBounds` to fit map
overlays that run outside the active lap). `SessionContext` carries
`overlayLines` + `onToggleOverlay` + the external-file loader/adder + the align
toggle. **Cross-session overlays (`snap:`/`file:`) can be drift-aligned** onto the
current lap via `lib/lapAlignment.ts` (2D Kabsch rigid registration, map-only —
charts compare by distance and are transform-invariant); same-session `lap:`
overlays are never transformed. The **Align lines** toggle lives on the map
legend (`useLapOverlays.alignOverlays`, default on). A sibling **collapse-legend**
toggle (`useLapOverlays.showOverlayLegend`, default on; same legend on both
`RaceLineView` + `MiniMap`) folds the per-lap *list* down to a compact "N overlays"
pill so a crowded 5+ line-up doesn't bury the map under labels — the racing lines
themselves stay drawn (it hides only the legend chrome, not the overlays).
**The current lap always renders on top** —
maps put overlays in a layer beneath the current heatmap; charts draw overlay
traces before the current line. Chart overlays distance-align each lap onto the
current lap via `alignByDistance` (`referenceUtils.ts`), over the full lap then
sliced to the visible window (anchored at start-finish, like the reference);
synthetic `__pace__`/`__braking_g__` series don't overlay. **Phase 1 is raw
absolute GPS** (same-session laps share a receiver, so they register without
correction); cross-session drift-alignment and external/cross-logger sources are
deferred — see `docs/plans/multi-lap-overlay.md`.

Channels are normalized to canonical ids at parse time (`channels.ts` →
`normalizeChannels()`), so `extraFields` keys and `FieldMapping.name` are uniform
across formats (e.g. every parser's lateral-g lands on `lat_g`, with display
`label` "Lat G"). G-force is modelled as distinct ids per source — `lat_g`/`lon_g`
(primary/GPS-derived), `lat_g_native`/`lon_g_native` (logger-native), `accel_x/y/z`
(raw IMU) — which coexist on a sample and must never collapse. `fieldResolver.ts`
is the settings-facing adapter (resolves names→ids for the field-default
show/hide). `toChannelKey()` is the idempotent shim that migrates legacy
display-name keys persisted in graph-prefs / saved overlay configs on load, so
existing user data keeps resolving without a destructive migration.

---

## Environment Variables

| Variable | Client/Server | Description |
|----------|--------------|-------------|
| `VITE_SUPABASE_URL` | Client | Backend URL (auto-set) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | Backend anon key (auto-set) |
| `VITE_SUPABASE_PROJECT_ID` | Client | Backend project ID (auto-set) |
| `VITE_ENABLE_ADMIN` | Client | `"true"` to enable admin UI + `/admin` route. `/login` is also mounted when this OR `VITE_ENABLE_CLOUD` is on. |
| `VITE_ENABLE_CLOUD` | Client | `"true"` to enable public user accounts (Cloud Sync + email sign-in + `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`). Default `"false"` — preserves offline-first invariant. |
| `VITE_ENABLE_GOOGLE_AUTH` | Client | `"true"` to show the "Continue with Google" buttons (Login/Register/Profile). Requires `VITE_ENABLE_CLOUD`. Default `"false"`: Google sign-in still routes through Lovable's OAuth broker (`src/integrations/lovable/`), so it's gated off until native Supabase Google OAuth is wired up. |
| `VITE_TURNSTILE_SITE_KEY` | Client | Cloudflare Turnstile site key (optional CAPTCHA) |
| `TURNSTILE_SECRET_KEY` | Server (edge fn) | Turnstile secret — `???` |
| `VITE_FIRMWARE_MANIFEST_URL` | Client | Override the logger firmware OTA manifest URL. When unset, `main` builds use the production manifest (`…/DovesDataLogger/manifest.json`) and non-`main`/preview builds use the **beta channel** (`…/DovesDataLogger/beta/manifest.json`) — same `isPreviewBuild()` switch as the footer/preview-DB. Set this to force a specific channel on any branch. |
| `DOVE_PLUGIN_PACKAGES` | Build | Comma-separated external plugin npm packages to load. Overrides the default (`@perchwerks/eye-in-the-sky`) when set |
| `VITE_APP_VERSION` / `VITE_GIT_HASH` / `VITE_BUILD_DATE` / `VITE_GIT_BRANCH` / `VITE_GIT_COMMIT_DATE` | Build (auto) | Footer version stamp — **not hand-set**. `vite.config.ts` bakes them in from `package.json` + git (`buildInfo.ts` reads them). The stamp mirrors the `_PREVIEW` switch: `main` shows `v<version> · <hash>`; any other branch shows `<branch> · <hash> · <commit time>`. Hash prefers CI SHAs (`WORKERS_CI_COMMIT_SHA`/`CF_PAGES_COMMIT_SHA`/`GITHUB_SHA`), branch prefers CI branch vars (`WORKERS_CI_BRANCH`/`CF_PAGES_BRANCH`/`GITHUB_REF_NAME`); both fall back to local `git`, then `"unknown"`. |

PWA deployment detail: the active offline-capable worker is emitted as `/service-worker.js` and registered only outside preview/iframe contexts. `public/sw.js` is reserved as a legacy kill-switch worker to evict stale caches from older installs that previously registered `/sw.js`.

Static hosting (Cloudflare Workers): the build is a pure static SPA (no server runtime). `wrangler.jsonc` (repo root) configures a static-assets-only Worker — no `main` script — with `assets.directory: "./dist"` and `not_found_handling: "single-page-application"` for client-side route fallback. `public/_headers` (copied into `./dist` by Vite, honored by Workers static assets) sets `no-cache` on the service workers + `index.html` and immutable long-cache on `/assets/*`. `.nvmrc` pins Node 20. Workers Builds runs `npm run build` then `wrangler deploy`. Supabase edge functions stay on Supabase — the Worker only serves the frontend. See the README "Deployment" section.

`vite.config.ts` defines public backend fallbacks for `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID` so production builds still boot if managed env injection is missing; `.env` stays the preferred source when present.

Per-branch preview backend: `vite.config.ts`'s `pick()` checks `WORKERS_CI_BRANCH` (Cloudflare Workers Builds) / `CF_PAGES_BRANCH` (Pages) and, on any non-`main` branch, prefers a parallel `*_PREVIEW` value for each key (`VITE_<KEY>_PREVIEW` or `HTT_<KEY>_PREVIEW`) before the normal value/fallback. This lets beta/preview deployments bake in a Supabase **preview-branch** database (creds are build-time-baked, never runtime). `main` builds and local dev never read the `_PREVIEW` vars. See the README "Preview-branch backend" deployment section.

---

## Commands

```bash
npm run dev        # Dev server on :8080
npm run build      # Production build → dist/
npm run lint       # ESLint
npm run typecheck  # tsc -b (must use build mode to follow project references)
npm run preview    # Preview production build
npm test           # Vitest in watch mode
npm run test:run   # Vitest single pass (CI-style)
npm run test:coverage  # Vitest + v8 coverage (enforces thresholds in vitest.config.ts)
```

> **Coverage scope (`vitest.config.ts`).** Coverage is deliberately scoped to
> *logic worth unit-testing* — `lib/` parsers/utilities/protocol code, `hooks/`,
> and `plugins/`. The React **view layer is excluded**: presentational
> components (`src/components/**/*.tsx`), route/page shells (`src/pages/**`),
> context providers (`src/contexts/**`), `App.tsx`, vendored `ui/`, and the
> generated Supabase client. Note the exclude targets `components/**/*.tsx`
> *only* — the `.ts` logic files under `components/video-overlays/` stay in
> scope. Don't widen the include to pull view code back in (it tanks the number
> with code nobody unit-tests) and don't exclude `hooks/`/`lib/` to inflate it
> (that hides real test debt). Thresholds are floors a few points below current
> actuals — ratchet them up as coverage grows.

> **Why `tsc -b`?** The root `tsconfig.json` has `files: []` and only uses
> `references` to point at `tsconfig.app.json` + `tsconfig.node.json`. Plain
> `tsc --noEmit` from repo root silently exits 0 without checking anything.
> `tsc -b` (build mode) follows references; both referenced configs have
> `noEmit: true` so nothing is emitted.

CI is split into five parallel workflows under `.github/workflows/`
(`lint.yml`, `typecheck.yml`, `test.yml`, `build.yml`, `coverage.yml`). Each
runs on every PR and push to `main` and shows up as its own status check +
README badge. `coverage.yml` also enforces the thresholds in `vitest.config.ts`,
posts a per-PR summary comment, and pushes the % badge fields to a **GitHub Gist**
(repo secret `GIST_TOKEN` + repo variable `COVERAGE_GIST_ID`) — not a Git branch,
so Cloudflare Workers Builds has no badge-only branch to try to deploy. See the
README "Coverage badge" section for the gist wiring.

---

## Bundle Splitting / Code-Splitting

The initial bundle is kept small via `React.lazy` boundaries plus
`manualChunks` vendor splitting in `vite.config.ts`. Keep this in mind when
adding imports — pulling a lazy module into an eagerly-imported file
re-merges it into the main chunk.

**Lazy-loaded (off the initial path) — loaded on first use:**
- Routes: `Login`, `Admin`, `Register`, `Privacy` (`App.tsx`, wrapped in `<Suspense>`)
- View tabs: `RaceLineTab` (the Simple tab — keeps `vendor-leaflet` + the
  telemetry chart off the landing page; loads the moment a session opens),
  `GraphViewTab`, and `LabsTab` (`Index.tsx`)
- `FileManagerDrawer` (slide-out drawer, `Index.tsx`)
- `DataloggerDownload` (BLE entry point; keeps `lib/ble/*` out of initial bundle — `FileImport.tsx`, `drawer/FilesTab.tsx`)
- `CourseSectorEditor` (lazy; wraps `VisualEditor` + `SectorListEditor`, used by `TrackEditor.tsx`, `track-editor/AddCourseDialog.tsx`, `admin/CoursesTab.tsx`). The shared map+list editor for **all** track managers — start/finish + every sector line (select a row → drag its endpoints on the map, auto-saved on release) and the course-outline Draw/Generate tools (auto-saved on each edit; no Done/Close button). The sector list (dnd-kit) is the control surface; there is no manual coordinate-entry mode. `@dnd-kit/*` rides this lazy boundary, off the initial bundle.

**Vendor chunks** (`manualChunks` in `vite.config.ts`): `vendor-react`,
`vendor-query`, `vendor-leaflet`, `vendor-supabase`, `vendor-radix`. These cache
independently across deploys so app-only changes don't re-download vendor code.

**`vendor-supabase` is fully off the eager graph.** The Supabase client's only
static importers are lazy/flag-gated modules: `contexts/authBackend.ts` (the
auth bootstrap, dynamically imported by `AuthContext` **only when
`VITE_ENABLE_ADMIN` or `VITE_ENABLE_CLOUD` is on** — flag-off builds never
fetch it at all), the lazy auth/admin pages, and cloud-sync's lazy panels.
Everything that rides the eager graph (`SubmitTrackDialog`, `PricingCards`,
`useStripePrices`/`useSubscription`) reaches `billingClient`/the client via
dynamic import at the call site. Don't add a static
`@/integrations/supabase/client` (or `lib/billingClient`) import to anything
eagerly reachable from `Index.tsx`/`LandingPage` — it re-merges 172 kB of
Supabase into the offline-first landing payload.

> Lazy components must be rendered inside a `<Suspense>` boundary. Use
> `lazy(() => import('…').then((m) => ({ default: m.Named })))` for the
> named-export components in this codebase.

---

## Key Conventions

- **No server when client works** — this is the #1 rule
- **Hooks are composable** — each hook does one thing, `Index.tsx` orchestrates
- **Parsers**: always export `isXxxFormat()` + `parseXxxFile()`, register in `datalogParser.ts`
- **IndexedDB stores**: all registered in `dbUtils.ts`, individual modules use `withReadTransaction` / `withWriteTransaction`
- **Tracks**: `public/tracks.json` is the source of truth at runtime; admin DB builds this file. Export format includes `longName`, `shortName`, `defaultCourse`, and per-course `lengthFt`. Tracks table has `default_course_id` FK. Course `lengthFt` values are imported as `length_ft_override` in the database.
- **Course Detection**: `courseDetection.ts` handles auto-detection of track/course/direction on file load, with waypoint mode fallback. Find nearest track within 5mi, match course by lap distance vs `lengthFt`.
- **Course Drawings**: Admin can export/import course layout drawings separately from tracks. Import clears `length_ft_override` for imported courses (drawing becomes source of truth).
- **CSS**: use Tailwind semantic tokens from `index.css`, never hardcode colors in components (e.g. `--warning`/`warning` — amber, light+dark — used for the preview-build footer)
- **Admin code** is fully optional and gated behind env vars — core app has zero admin dependencies
- **Edge functions** live in `supabase/functions/`, auto-deployed, configured in `supabase/config.toml`
- **Stale-state gotcha**: When calling a function immediately after `setState`, the new value isn't available in the current closure. Pass values explicitly (e.g., `calculateAndSetLaps(course, samples, fileName)`) instead of relying on state that was just set.

---

_Closing reminders, in the author's words (these reiterate the Golden Rules — kept
because they set the tone): **never do on the server what you can do on the
client** — 99% offline is the number-one priority (weather, satellite view, admin
excepted). **Keep code modular and reusable** — fuck line count as long as you
reuse the shit out of things; rewrites for reusability are always welcome. Keep
`README.md` current (ALWAYS note new env vars + their values, `???` for secrets)
and the Credits list current. And **always keep `CLAUDE.md` updated** with new
files and architecture as you go._
