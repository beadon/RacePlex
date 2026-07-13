/**
 * Host pub/sub for "a CSV needs its columns mapped" — framework-agnostic (mirrors
 * `fileLoadingState.ts`), so the parser layer can ask the rider a question without importing React.
 *
 * The generic CSV importer raises a request; `<CsvMappingDialog>` (mounted once in App) subscribes,
 * shows the proposed mapping, and resolves the promise with the rider's answer (or null if they
 * cancel). Because it hangs off the async parse, this works for EVERY entry point that loads a
 * session — drag-drop import, file-manager reopen, cloud open — not just the import card.
 *
 * When nothing is subscribed (unit tests, the synchronous BLE/sample paths) the request resolves
 * immediately with the auto-proposed mapping. A headless caller must never hang waiting for a
 * dialog that cannot appear.
 */

import type { CsvColumnMapping, GenericCsvAnalysis } from './genericCsvParser';
import { beginFileLoading, endFileLoading, getFileLoading } from './fileLoadingState';

export interface CsvMappingRequest {
  analysis: GenericCsvAnalysis;
  fileName?: string;
  /** Confirm the (possibly corrected) mapping. */
  resolve: (mapping: CsvColumnMapping) => void;
  /** Abandon the import. */
  cancel: () => void;
}

type Listener = (request: CsvMappingRequest | null) => void;

let current: CsvMappingRequest | null = null;
const listeners = new Set<Listener>();

export function getCsvMappingRequest(): CsvMappingRequest | null {
  return current;
}

export function subscribeCsvMappingRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when a dialog host is mounted and can actually answer. */
export function hasCsvMappingHost(): boolean {
  return listeners.size > 0;
}

/**
 * Ask the rider to confirm a mapping. Resolves with the proposal untouched when no host is
 * listening, and with `null` when the rider cancels the import.
 */
export function requestCsvMapping(
  analysis: GenericCsvAnalysis,
  fileName?: string,
): Promise<CsvColumnMapping | null> {
  if (listeners.size === 0) return Promise.resolve(analysis.mapping);

  // The file-loading overlay is up (parseDatalogFile brackets the whole load with it). Drop it
  // while we wait on a human, and put it back afterwards — a spinner behind a question is a lie.
  const wasLoading = getFileLoading();
  endFileLoading();

  return new Promise<CsvColumnMapping | null>((resolve) => {
    const settle = (value: CsvColumnMapping | null) => {
      current = null;
      for (const listener of listeners) listener(null);
      if (wasLoading) beginFileLoading(wasLoading.message);
      resolve(value);
    };

    current = {
      analysis,
      fileName,
      resolve: (mapping) => settle(mapping),
      cancel: () => settle(null),
    };
    for (const listener of listeners) listener(current);
  });
}
