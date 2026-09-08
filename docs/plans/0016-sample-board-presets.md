# 0016 — Sample board presets (flagship e-skateboards)

## Goal

Adding a board in the garage means typing the same published specs over and
over (engine, weight, drivetrain, truck, battery, deck, wheels). Riders should
be able to **pick their board** and have the forms prefill.

## Approach

- `src/lib/sampleBoards.ts` — a static catalog of each vendor's top-of-the-line
  board, researched from the vendors' own sites on **2026-09-07**
  (`SAMPLE_BOARD_CHECKED_AT`), each entry carrying its `sourceUrl`:
  - Lacroix Nazaré Supersport
  - Stooge Race Boards V7 CST (2WD 30kW)
  - Radium Performance Mach One S
  - Evolve Diablo Carbon (Street)

  (Boosted was on the original vendor list but is no longer in business —
  site offline at check time — so it has no preset.)

  Each board maps onto the two existing records:
  - `Vehicle` fields: engine, drivetrain, truck type, battery pack (S-count,
    nominal V, Wh, chemistry, BMS), board weight.
  - `VehicleSetup` fields: the default eSkate template's `customFields`
    (deck length, wheelbase, truck width, wheel type/duro, drive, motor kV,
    pulleys, cell config, capacity) plus the built-in tire block.

- **Vehicles tab** (new-vehicle form): a "Board preset" select above the type
  picker. Choosing a board prefills name (if empty), engine, weight (kg),
  drivetrain, trucks and battery.
- **Setups tab** (new-setup form, built-in eSkate template only): the same
  preset select below the vehicle picker. Choosing a board prefills the setup
  name (if empty), custom fields (merged over existing values) and the tire
  block.
- Unpublished specs are left blank, never guessed. Values that exceed the
  template's input ranges (raceboard wheelbases/hanger widths) are correct as
  published and are allow-listed in `sampleBoards.test.ts`, which also enforces
  field-id validity, range conformance, and battery S-count/voltage consistency.

## Constraints

- No network at runtime (Golden Rule 1): the catalog ships in the bundle.
- Presets only ever *prefill* — the user reviews and saves.
- i18n: new keys are English-only; other locales fall back per
  `fallbackLng: en` (parity tests only forbid keys that English lacks).
