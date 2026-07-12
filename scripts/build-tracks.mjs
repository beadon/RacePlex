#!/usr/bin/env node
/**
 * Build `public/tracks.json` + `public/drawings.json` from the `tracks/` records.
 * Plan 0008 — the tracks directory is the database; these two are artifacts.
 *
 *   bun run build:tracks         write the artifacts
 *   bun run build:tracks --check validate + verify the committed artifacts are
 *                                current, write nothing (CI)
 *
 * Runs as `prebuild`, so a build cannot ship a stale artifact. The generated
 * files are committed too — `bun run dev` serves them straight from `public/`
 * without a build step.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDrawingsJson, buildTracksJson, stringify } from './tracks-format.mjs';
import { validateCollection } from './tracks-validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS_DIR = join(root, 'tracks');
const OUT_TRACKS = join(root, 'public', 'tracks.json');
const OUT_DRAWINGS = join(root, 'public', 'drawings.json');

const check = process.argv.includes('--check');

/** Read every `tracks/*.json` as `{ file, track }`. */
function readRecords() {
  const files = readdirSync(TRACKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(join(TRACKS_DIR, file), 'utf8');
    try {
      return { file, track: JSON.parse(raw) };
    } catch (e) {
      console.error(`\n✗ tracks/${file} is not valid JSON: ${e.message}\n`);
      process.exit(1);
    }
  });
}

const records = readRecords();

const problems = validateCollection(records);
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'} in tracks/:\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('');
  process.exit(1);
}

const tracks = records.map((r) => r.track);
const tracksJson = stringify(buildTracksJson(tracks));
const drawingsJson = stringify(buildDrawingsJson(tracks));

if (check) {
  const stale = [];
  if (readFileSync(OUT_TRACKS, 'utf8') !== tracksJson) stale.push('public/tracks.json');
  if (readFileSync(OUT_DRAWINGS, 'utf8') !== drawingsJson) stale.push('public/drawings.json');
  if (stale.length > 0) {
    console.error(
      `\n✗ ${stale.join(' and ')} ${stale.length === 1 ? 'is' : 'are'} out of date.\n` +
        `  Run \`bun run build:tracks\` and commit the result.\n`,
    );
    process.exit(1);
  }
  const courses = tracks.reduce((n, t) => n + t.courses.length, 0);
  console.log(`✓ ${tracks.length} track(s), ${courses} course(s) — artifacts current.`);
} else {
  writeFileSync(OUT_TRACKS, tracksJson);
  writeFileSync(OUT_DRAWINGS, drawingsJson);
  const courses = tracks.reduce((n, t) => n + t.courses.length, 0);
  console.log(
    `✓ ${tracks.length} track(s), ${courses} course(s) → public/tracks.json + public/drawings.json`,
  );
}
