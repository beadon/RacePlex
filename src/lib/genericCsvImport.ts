/**
 * Ties the three halves of the generic CSV import together: analyse the file, remember (or ask
 * for) the mapping, parse.
 *
 * Kept apart from `genericCsvParser.ts` so the parser itself stays pure and headlessly testable —
 * no storage, no UI, no promises.
 */

import type { ParsedData } from '@/types/racing';
import { loadCsvMapping, saveCsvMapping } from './csvMappingStorage';
import { requestCsvMapping } from './csvMappingRequest';
import { analyzeGenericCsv, parseGenericCsvTable } from './genericCsvParser';

/**
 * The interactive path (drag-drop, file-manager reopen, cloud open — everything that goes through
 * the async `parseDatalogFile`).
 *
 * A remembered mapping short-circuits the dialog entirely, which is the whole point of hashing the
 * header: a returning rider with the same device never sees it twice.
 */
export async function importGenericCsv(content: string, fileName?: string): Promise<ParsedData> {
  const analysis = analyzeGenericCsv(content);

  const remembered = loadCsvMapping(analysis.headerHash);
  if (remembered) {
    return parseGenericCsvTable(analysis.table, remembered);
  }

  const chosen = await requestCsvMapping(analysis, fileName);
  if (!chosen) {
    throw new Error('CSV import cancelled — no column mapping was confirmed.');
  }

  saveCsvMapping(analysis.headerHash, chosen, analysis.table.columns);
  return parseGenericCsvTable(analysis.table, chosen);
}

/**
 * The synchronous path (`parseDatalogContent` — BLE download, the bundled sample). Nothing can ask
 * the rider anything here, so a remembered mapping is used if we have one and the auto-proposal is
 * used if we do not.
 */
export function importGenericCsvSync(content: string): ParsedData {
  const analysis = analyzeGenericCsv(content);
  const mapping = loadCsvMapping(analysis.headerHash) ?? analysis.mapping;
  return parseGenericCsvTable(analysis.table, mapping);
}
