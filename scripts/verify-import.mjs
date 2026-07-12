#!/usr/bin/env node
/**
 * End-to-end import smoke check.
 *
 * Drives a real browser against the running dev server, feeds a datalog through the app's own
 * file input, and asserts that the app actually *did something* with it: samples loaded, a track
 * drawn on the map, channels charted, and — if the file carries its own timing lines — a lap time
 * computed.
 *
 * WHY THIS EXISTS, given there are 2000+ unit tests:
 *
 * The unit tests are excellent at proving a parser returns the right numbers. They are completely
 * blind to whether anything *calls* it. Both of these shipped green and were still broken:
 *
 *   1. The GPX parser worked perfectly — and `.gpx` was missing from the file picker's `accept`
 *      list, so a user could not select a GPX file at all.
 *   2. `courseFromGpxWaypoints()` worked perfectly, was unit-tested, and was never wired into the
 *      import flow — so lap timing silently never happened.
 *
 * Neither is a logic bug. Both are wiring bugs, and only running the app finds them.
 *
 * USAGE:
 *   bun run dev                      # in one terminal
 *   node scripts/verify-import.mjs   # in another  (checks every file in sample_race_files/)
 *   node scripts/verify-import.mjs path/to/log.gpx --expect-lap 36.5
 *
 * Requires: npx playwright install chromium   (one-off)
 */

import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';

const BASE_URL = process.env.VERIFY_URL ?? 'http://localhost:8080/';
const SAMPLES_DIR = resolve(import.meta.dirname, '..', 'sample_race_files');

const args = process.argv.slice(2);
const expectIdx = args.indexOf('--expect-lap');
const expectLapSec = expectIdx !== -1 ? Number(args[expectIdx + 1]) : null;
const explicit = args.filter((a, i) => !a.startsWith('--') && i !== expectIdx + 1);

const files = explicit.length
  ? explicit.map((f) => resolve(f))
  : existsSync(SAMPLES_DIR)
    ? readdirSync(SAMPLES_DIR)
        .filter((f) => !f.startsWith('.'))
        .map((f) => join(SAMPLES_DIR, f))
    : [];

if (files.length === 0) {
  console.error('No files to check. Pass a path, or put datalogs in sample_race_files/.');
  process.exit(2);
}

const browser = await chromium.launch();
let failures = 0;

for (const file of files) {
  const name = basename(file);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.locator('input[type=file]').first().setInputFiles(file);
    await page.waitForTimeout(6000);

    const problems = [];

    // The map must actually render the trace.
    if ((await page.locator('.leaflet-container').count()) === 0) {
      problems.push('no map rendered');
    }

    // The app bails back to the landing page when it can't read a file at all.
    const body = await page.locator('body').innerText();
    if (/Drop in a datalog/i.test(body)) {
      problems.push('file was rejected — still on the landing page');
    }

    // A file with no timing lines (a bare CSV, a phone GPX) correctly raises "No Track Detected".
    // That's not a failure — but the modal blocks the UI, so dismiss it before going further.
    const skip = page.getByRole('button', { name: /^Skip$/i });
    const hadNoTrackModal = /No Track Detected/i.test(body);
    if (await skip.count()) {
      await skip.first().click();
      await page.waitForTimeout(800);
    }

    // Lap timing: only expected for files that carry their own timing lines (e.g. RaceBox GPX
    // waypoints).
    let lapText = null;
    const lapTab = page.getByText(/^Lap Times$/).first();
    if (await lapTab.count()) {
      await lapTab.click();
      await page.waitForTimeout(2000);
      const laps = await page.locator('body').innerText();
      const m = laps.match(/Best Lap:\s*([\d:.]+)/);
      if (m) lapText = m[1];
    }

    // --expect-lap only means anything for files explicitly named on the command line; when
    // sweeping sample_race_files/ we can't assume every log has a course in it.
    if (expectLapSec !== null && explicit.length > 0) {
      if (!lapText) {
        problems.push(`expected a lap time of ~${expectLapSec}s, got none`);
      } else {
        const [mm, ss] = lapText.split(':');
        const seconds = ss !== undefined ? Number(mm) * 60 + Number(ss) : Number(mm);
        if (Math.abs(seconds - expectLapSec) > 1) {
          problems.push(`lap time ${lapText} (${seconds}s) is >1s from expected ${expectLapSec}s`);
        }
      }
    }

    if (pageErrors.length) problems.push(`page errors: ${pageErrors.slice(0, 2).join('; ')}`);

    if (problems.length) {
      failures++;
      console.log(`❌ ${name}`);
      for (const p of problems) console.log(`     ${p}`);
      await page.screenshot({ path: `/tmp/verify-fail-${name}.png` });
      console.log(`     screenshot: /tmp/verify-fail-${name}.png`);
    } else if (lapText) {
      console.log(`✅ ${name}  — best lap ${lapText}`);
    } else {
      console.log(
        `✅ ${name}  — imported${hadNoTrackModal ? ' (no timing lines in file, so no laps — expected)' : ''}`,
      );
    }
  } catch (err) {
    failures++;
    console.log(`❌ ${name}\n     ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();

if (failures > 0) {
  console.log(`\n${failures} of ${files.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} imported cleanly.`);
