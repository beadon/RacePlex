/**
 * Remembered column mappings for the generic CSV importer.
 *
 * Keyed by a hash of the file's SHAPE — delimiter + column names (`headerHash` in
 * genericCsvParser). A rider's second ride off the same device produces the same header, so it
 * hashes the same, so their correction is remembered and the mapping dialog never appears again.
 * A firmware update that changes the columns changes the hash, and they get asked once more —
 * which is exactly right, because the mapping may genuinely have changed.
 *
 * localStorage rather than IndexedDB deliberately: the lookup has to be SYNCHRONOUS, because
 * `parseDatalogContent()` is synchronous and must be able to answer "do we already know this
 * device?" without an await. Tracks live in localStorage for the same kind of reason.
 */

import type { CsvColumnMapping } from './genericCsvParser';

const STORAGE_KEY = 'raceplex-csv-mappings-v1';

export interface StoredCsvMapping {
  mapping: CsvColumnMapping;
  /** The column names this was saved against — for debugging and for the settings UI later. */
  columns: string[];
  /** ms epoch, so a future cleanup can evict mappings nobody has used in a year. */
  savedAt: number;
}

type MappingStore = Record<string, StoredCsvMapping>;

function readStore(): MappingStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MappingStore) : {};
  } catch {
    // A corrupt or unavailable store must never break an import — we just re-ask.
    return {};
  }
}

function writeStore(store: MappingStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Could not persist CSV column mapping:', e);
  }
}

/** The mapping this rider already confirmed for this header shape, if any. */
export function loadCsvMapping(hash: string): CsvColumnMapping | null {
  return readStore()[hash]?.mapping ?? null;
}

export function saveCsvMapping(hash: string, mapping: CsvColumnMapping, columns: string[]): void {
  const store = readStore();
  store[hash] = { mapping, columns, savedAt: Date.now() };
  writeStore(store);
}

export function deleteCsvMapping(hash: string): void {
  const store = readStore();
  delete store[hash];
  writeStore(store);
}

/** Every remembered mapping, newest first. */
export function listCsvMappings(): Array<StoredCsvMapping & { hash: string }> {
  return Object.entries(readStore())
    .map(([hash, value]) => ({ hash, ...value }))
    .sort((a, b) => b.savedAt - a.savedAt);
}
