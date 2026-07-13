/**
 * Seed catalog of common eskate remotes. First-run population of the `remotes`
 * store when a new user has no rows yet — riders add their own, and the seed
 * gives them a starter set so pairing a board doesn't start from empty.
 *
 * Ids use a stable prefix so re-seeding is idempotent (a row already present
 * is left alone). Radio + range are best-effort based on public specs; a rider
 * with better numbers should edit theirs.
 */

import type { Remote } from './remoteStorage';

/**
 * Ids are prefixed with `seed-` so `saveRemote` writes without collision-checks,
 * and so if we ever want to identify seeded rows for a "reset catalog" action
 * they're grep-able.
 */
export const REMOTE_CATALOG_SEED: Array<Omit<Remote, 'createdAt' | 'updatedAt' | 'userId'>> = [
  { id: 'seed-hoyt-puck-v2', brand: 'Hoyt Skate', model: 'Puck v2', radio: '2.4 GHz', batteryLifeHours: 20, rangeMeters: 100 },
  { id: 'seed-hoyt-puck-v1', brand: 'Hoyt Skate', model: 'Puck v1', radio: '2.4 GHz', batteryLifeHours: 15, rangeMeters: 90 },
  { id: 'seed-flipsky-vx4', brand: 'Flipsky', model: 'VX4 Pro', radio: '2.4 GHz', batteryLifeHours: 25, rangeMeters: 150 },
  { id: 'seed-flipsky-vx3', brand: 'Flipsky', model: 'VX3', radio: '2.4 GHz', batteryLifeHours: 20, rangeMeters: 120 },
  { id: 'seed-flipsky-vx2', brand: 'Flipsky', model: 'VX2 Pro', radio: '2.4 GHz', batteryLifeHours: 15, rangeMeters: 100 },
  { id: 'seed-maytech-v4', brand: 'Maytech', model: 'MTSKR-V4', radio: '2.4 GHz', batteryLifeHours: 30, rangeMeters: 200 },
  { id: 'seed-maytech-1905', brand: 'Maytech', model: 'MTSKR1905WF', radio: '2.4 GHz', batteryLifeHours: 25, rangeMeters: 200 },
  { id: 'seed-metr-pro', brand: 'Metr', model: 'Pro Remote', radio: 'BLE', batteryLifeHours: 12, rangeMeters: 30, notes: 'Bluetooth to the ESC via a Metr module.' },
  { id: 'seed-lingyi', brand: 'LingYi', model: 'Stock', radio: '2.4 GHz', batteryLifeHours: 10, rangeMeters: 80, notes: 'Ships stock with many Chinese hub-drive boards.' },
  { id: 'seed-gt2b-mod', brand: 'FlySky', model: 'GT2B (modded)', radio: '2.4 GHz', batteryLifeHours: 40, rangeMeters: 300, notes: 'DIY builder favourite; long range at the cost of size.' },
];
