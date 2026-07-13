# 0010 — eSkate vehicle model

## Goal

RacePlex is eskate-first, but the `Vehicle` record it inherited from upstream
was built for karts: `{ id, name, vehicleTypeId, engine, number, weight,
weightUnit, publicProfile }`. That's not enough to describe an electric
skateboard build. Two consequences:

- Riders can't record what board they were on beyond a name and a free-form
  engine string.
- Tools that could reason about a specific build (seat-position CoG, future
  gearing/top-speed calculators, coach heuristics) have nothing structured to
  read.

Goal: capture the physical build in enough structured detail to be useful,
without turning the garage form into a spec sheet the user has to fill in
before they can save.

## Constraints

- **Offline-first (Golden Rule 1).** All fields live in IndexedDB; nothing
  requires the cloud plugin.
- **Progressive disclosure.** Basic fields are visible immediately. The rest is
  behind an "Advanced" disclosure that stays collapsed by default. Every field
  outside `name` and `engine` is optional.
- **Small commits, tests included (Rule 3).** Each field group lands with a
  storage type change, form UI, and — where math is involved — vitest coverage.
- **English-only for new UI** (per prior direction). Skip the i18n round-trip.
- **No IDB schema bump.** Every new field is optional; old records keep working.
  Only a new `remotes` store bumps `DB_VERSION`.
- **Content-addressed setup revisions stay decoupled.** Setup sheets already
  freeze on assignment via `setupRevision*.ts`; vehicle-level fields describe
  the *chassis*, not the tunable setup.

## Model

### Field groups

**Basic (always visible)**
- `name` — required.
- `vehicleTypeId` — required; unlocked when >1 type exists.
- `engine` — required (a name string from the reusable engine list).
- `number` — rider number.
- `weight` + `weightUnit` — board weight without rider.
- `publicProfile` — kept on the type for storage compat; the "Show on profile"
  toggle and public badge were removed from the garage UI, since RacePlex ships
  with cloud disabled and local users make the concept moot.

**Advanced (collapsed by default)** — everything else is under a single
`<Advanced>` disclosure. Grouped by physical subsystem.

#### Drivetrain (already landed, task #38)
- `drivetrain: 'belt' | 'direct' | 'hub' | 'gear' | 'other'`
- `drivetrainOther?: string`
- `truckType: 'RPK' | 'TKP' | '3-link' | 'Stock' | 'other'`
- `truckTypeOther?: string`

#### Motor (on `Engine`, not `Vehicle` — a "Focbox + 2× 63100" is reusable across builds)
- `motorKind: 'BLDC' | 'PMSM' | 'DC' | 'other'` (default `BLDC`)
- `motorKindOther?: string`

#### Battery (task #39)
- `batteryVoltageNominalV?: number` — nominal pack voltage.
- `batteryCells?: number` — cell count in series (13, 14, 20 …). Redundant with
  voltage but useful because eskate speaks in "13S" more than "48V".
- `batteryCellChemistry?: 'Li-ion' | 'LiPo' | 'LiFePO4' | 'other'`
- `batteryCellChemistryOther?: string`
- `batteryCapacityWh?: number` — energy.
- `batteryContinuousDischargeA?: number` — continuous current rating (A).
- `batteryBurstDischargeA?: number` — burst rating (A). Optional.
- `batteryBmsMake?: string` — free-form (Bestech, Daly, ANT, DieBieMS, …).
- `batteryBmsModel?: string` — free-form.

*Why voltage AND cells?* Cell count is the load-bearing number for a rider
("14S runs faster than 13S at the same wheels"). Voltage is the load-bearing
number for a physicist. Both fields are one keystroke each; keeping both saves
the mental math.

#### Wheels / gearing (future — captured here for reference, not landing yet)
- `wheelDiameterMm?: number`
- `wheelDuroA?: number` — durometer (A-scale) — 78A, 90A, etc.
- `pulleyMotorTeeth?: number` / `pulleyWheelTeeth?: number` — belt drives only.
- `gearRatio?: number` — computed or user-entered.
- `deckLengthMm?: number` / `wheelbaseMm?: number` — feeds the CoG/seat tool.

#### Remote (task #39)
- Remotes get their own store — a remote is used across boards and is worth
  reusing. See **Remotes catalog** below.
- On `Vehicle`: `pairedRemoteId?: string` — pointer into the catalog.

### Remotes catalog

New IDB store: `remotes` (bumps `DB_VERSION`).

```ts
interface Remote {
  id: string;
  brand: string;               // "Hoyt Skate", "Flipsky", "Maytech", "Metr", …
  model: string;               // "Puck v2", "VX3", "MTSKR-V4", "Pro Remote", …
  radio?: '2.4 GHz' | 'sub-GHz' | 'BLE' | 'other';
  radioOther?: string;
  batteryLifeHours?: number;
  rangeMeters?: number;
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}
```

Seeded on first run (only when the store is empty) with the common set:
Hoyt Puck v2, Flipsky VX3 / VX4, Maytech MTSKR-V4, Metr Pro, LingYi, GT2B mod,
Puck v1. The seed is a plain array in `lib/remoteCatalogSeed.ts` — checked in,
easy to extend by PR. Users add, edit, and delete freely; deleting a remote
that is paired on a vehicle nulls that vehicle's `pairedRemoteId`.

UI: a "Manage Remotes" dialog reachable from the Vehicles form (same pattern
as Manage Engines), plus a combobox on the vehicle form's Advanced section.

## Approach

Land in slices, each slice = one commit citing plan 0010.

1. **Basic vs Advanced disclosure** — refactor the VehiclesTab form so the
   existing fields (name/type/engine/number/weight) are the "Basic" block and
   the already-landed drivetrain/trucks moves under a collapsible "Advanced".
   No new fields; UI only.
2. **Battery fields** — add the eight battery fields on `Vehicle`, render them
   in Advanced under a "Battery" subheading.
3. **Remotes store + catalog UI** — new `remoteStorage.ts`, `useRemoteManager`
   hook, `RemoteCombobox` + Manage Remotes dialog, seed on first run.
4. **Pair remote on vehicle** — `pairedRemoteId` field, combobox in Advanced.
5. **(later)** Wheels / gearing — only when a tool actually consumes them.
   Adding fields no consumer reads is drag.

### Rejected alternatives

- **One giant flat form.** Overwhelming; user asked for progressive disclosure.
- **Structured tags / free-form JSON blob.** Would avoid schema changes but
  loses type safety and makes tool integration ("how many Wh is this pack?") a
  string-parsing chore.
- **`vehicleTypeId`-scoped forms.** Different fields per vehicle type — e.g.
  kart vs eskate. Right long-term, but the current fork is eskate-only and
  types are a plugin surface upstream owns. Revisit if we ever ship non-eskate
  types.
- **Modeling motor on `Vehicle` instead of `Engine`.** Rejected in task #38:
  a Focbox + 63100 combo is reusable across builds; drivetrain and trucks are
  per-board.

## Touch points

- `src/lib/vehicleStorage.ts` — new optional fields (battery, `pairedRemoteId`).
- `src/lib/engineStorage.ts` — `motorKind` already landed (task #38).
- `src/lib/remoteStorage.ts` — new store.
- `src/lib/remoteCatalogSeed.ts` — new seed array.
- `src/lib/dbUtils.ts` — bump `DB_VERSION`, add `remotes` to `STORE_NAMES`.
- `src/hooks/useRemoteManager.ts` — new hook.
- `src/components/drawer/VehiclesTab.tsx` — Basic/Advanced disclosure, battery
  form block, remote combobox.
- `src/components/drawer/RemoteCombobox.tsx` — new.
- `src/plugins/cloud-sync/` — remotes are a per-user store; syncs the same way
  engines do. (Falls under plan for local users; see #37.)

## Status

- **Done:**
  - drivetrain, trucks on Vehicle (task #38).
  - motorKind on Engine, defaulting to BLDC (task #38).
  - Basic/Advanced disclosure — everything but name/type/engine/weight is
    behind a collapsed section by default.
  - Battery pack — nine fields (cells, nominal V, chemistry, Wh,
    continuous/burst A, BMS make/model).
  - Remotes catalog (`remotes` store, v15) with per-user first-run seed of
    common eskate remotes, `Vehicle.pairedRemoteId`, and a Manage-remotes
    dialog.
  - Row display surfaces drivetrain · trucks · cells · Wh when set.
- **Still queued (not blocking, only when a consumer wants them):**
  - Wheels / gearing — `wheelDiameterMm`, `wheelDuroA`, pulley teeth,
    `gearRatio`, `deckLengthMm`, `wheelbaseMm`. Wire the seat-position tool
    to read `wheelbaseMm` from the active vehicle at the same time so riders
    stop re-entering it.

## Notes for future readers

The seat-position tool (`plugins/tools/seat-position/`) already models
`wheelbaseMm` internally with its own defaults. It does NOT read from
`Vehicle`. When wheels/gearing land, wire that tool to the active vehicle so
riders don't re-enter dimensions.
