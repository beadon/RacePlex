#!/usr/bin/env node
/**
 * README screenshot generator.
 *
 * Drives a real browser against the running dev server through the app's
 * primary flows and saves labelled PNGs into `docs/screenshots/`. The
 * README embeds them under `## Screens`. Regenerate them on every release
 * so the screenshots always match the app that shipped:
 *
 *   bun run dev                     # in one terminal
 *   node scripts/screenshots.mjs    # in another
 *
 * Requires: npx playwright install chromium   (one-off, same as verify:import)
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE_URL = process.env.SCREENSHOT_URL ?? 'http://localhost:8080/';
const OUT_DIR = resolve(import.meta.dirname, '..', 'docs', 'screenshots');
const SAMPLE_FILE = resolve(import.meta.dirname, '..', 'sample_race_files', 'RaceBox Track Sessionon 21-06-2026 13-43.gpx');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const browser = await chromium.launch();

/**
 * Every shot gets its OWN isolated context (empty IndexedDB, empty
 * localStorage, no cookies) so IDB state from an earlier shot never
 * changes what a later shot sees. Costs a browser context per shot,
 * which is cheap in Chromium and buys reproducibility.
 */
async function freshPage() {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // Retina — 2× resolution for crisp README rendering.
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  return page;
}

/** Snap a PNG under `docs/screenshots/<name>.png`. Reports the path. */
async function snap(page, name) {
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  ✓ ${name}.png`);
  return path;
}

/**
 * Import the bundled sample GPX. The file input lives inside FileImport,
 * which is mounted inside the ImportTile dialog on the dashboard — so we
 * open that dialog first, then drop the file. On a fresh install the
 * empty-state also offers a "Load a sample RaceBox session" link; either
 * path works and we prefer the tile→dialog one because it's the same flow
 * a user takes for their own files.
 */
async function importSample(page) {
  // Open the Import dialog if it isn't open yet — the ImportTile's clickable
  // face carries the text "Import" and lives on the dashboard's add-data row.
  const importTrigger = page.locator('button:has-text("Import")').first();
  if (await importTrigger.count()) {
    await importTrigger.click().catch(() => {});
    // The dialog animates in; wait for the file input to be mounted.
    await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 5000 });
  }
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE_FILE);
  // The parse is instant for a GPX; the map + charts render on the next tick.
  await page.waitForSelector('.leaflet-container', { timeout: 8000 });
  // Give the map + chart canvases one animation frame to finish drawing.
  await page.waitForTimeout(1200);
}

// ─── Dashboard (empty state) ───────────────────────────────────────────────
async function shotEmptyDashboard() {
  console.log('empty-dashboard/');
  const page = await freshPage();
  // Clear IDB so the dashboard shows its fresh-install empty state.
  await page.evaluate(async () => {
    if (typeof indexedDB === 'undefined') return;
    const dbs = await indexedDB.databases?.();
    if (!dbs) return;
    await Promise.all(dbs.map((d) => new Promise((res) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = req.onerror = req.onblocked = () => res(null);
    })));
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await snap(page, '01-dashboard-empty');
  await page.close();
}

// ─── Dashboard (with a session imported) ───────────────────────────────────
async function shotPopulatedDashboard() {
  console.log('populated-dashboard/');
  const page = await freshPage();
  await importSample(page);
  // Click the "home" button in the session header to bounce back to the
  // dashboard — now populated with one Recent Session, updated stats,
  // and the multi-select checkbox visible.
  await page.locator('button[aria-label*="home" i], button[aria-label*="Home" i]').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await snap(page, '02-dashboard-populated');
  await page.close();
}

// ─── Session view: race line map ───────────────────────────────────────────
async function shotSessionMap() {
  console.log('session-map/');
  const page = await freshPage();
  await importSample(page);
  // The RaceLine tab is the default view for a fresh session.
  await snap(page, '03-session-map');
  await page.close();
}

// ─── Session view: lap table (Lap Times tab) ──────────────────────────────
async function shotLapTable() {
  console.log('lap-table/');
  const page = await freshPage();
  await importSample(page);
  // The Lap Times tab has a lap-count badge next to its label, so an exact
  // `Lap Times` name match fails — accept anything starting with it.
  const lapTab = page.getByRole('button', { name: /^Lap Times/ }).first();
  await lapTab.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  await snap(page, '05-lap-table');
  await page.close();
}

// ─── Tools dialog (from the dashboard nav) ─────────────────────────────────
async function shotTools() {
  console.log('tools/');
  const page = await freshPage();
  // Open Tools from the dashboard nav. Look for the desktop nav-bar button
  // by its icon / label.
  const toolsBtn = page.locator('nav button:has-text("Tools"), header button:has-text("Tools")').first();
  if (await toolsBtn.count()) {
    await toolsBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    await snap(page, '06-tools-picker');

    // Open the Stance tool to show the sliders/model.
    const stanceBtn = page.locator('button:has-text("Stance")').first();
    if (await stanceBtn.count()) {
      await stanceBtn.click().catch(() => {});
      await page.waitForTimeout(600);
      await snap(page, '07-tools-stance');
    }
  }
  await page.close();
}

// ─── Garage ────────────────────────────────────────────────────────────────
async function shotGarage() {
  console.log('garage/');
  const page = await freshPage();
  const garageBtn = page.locator('nav button:has-text("Garage"), header button:has-text("Garage")').first();
  if (await garageBtn.count()) {
    await garageBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    await snap(page, '08-garage');
  }
  await page.close();
}

// ─── Settings ──────────────────────────────────────────────────────────────
async function shotSettings() {
  console.log('settings/');
  const page = await freshPage();
  const settingsBtn = page.locator('nav button:has-text("Settings"), header button:has-text("Settings")').first();
  if (await settingsBtn.count()) {
    await settingsBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    await snap(page, '09-settings');
  }
  await page.close();
}

// ─── Logger picker (Devices) ──────────────────────────────────────────────
async function shotLoggerPicker() {
  console.log('logger-picker/');
  const page = await freshPage();
  // Dashboard has a "Devices" tile / button that opens the LoggerPicker.
  const devicesBtn = page.locator('button:has-text("Download from Logger"), button:has-text("Connect"), button:has-text("Devices")').first();
  if (await devicesBtn.count()) {
    await devicesBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    await snap(page, '10-logger-picker');
  }
  await page.close();
}

// ─── Run every shot in sequence. Any single flakey step just logs its own
//     failure — the run continues so a change to one screen doesn't wipe
//     the whole set. ───────────────────────────────────────────────────────
// Numbers reserved to match the README file names — 04 (Pro/GraphView tab)
// was intentionally dropped because the Simple view already carries a
// telemetry chart under the map. Bring it back if the Pro layout starts
// carrying features the Simple view doesn't.
const shots = [
  shotEmptyDashboard,       // 01
  shotPopulatedDashboard,   // 02
  shotSessionMap,           // 03
  shotLapTable,             // 05
  shotTools,                // 06 + 07 (picker + Stance)
  shotGarage,               // 08
  shotSettings,             // 09
  shotLoggerPicker,         // 10
];

let failures = 0;
for (const shot of shots) {
  try {
    await shot();
  } catch (e) {
    failures++;
    console.error(`  ✗ ${shot.name} failed: ${e instanceof Error ? e.message : e}`);
  }
}

await browser.close();

if (failures) {
  console.error(`\n${failures} shot(s) failed.`);
  process.exit(1);
}
console.log(`\nAll shots written to ${OUT_DIR}/`);
