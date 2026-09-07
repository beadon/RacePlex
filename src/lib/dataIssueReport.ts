/**
 * Diagnostics for a rider's "this file isn't displaying right" report (plan 0014).
 *
 * RacePlex has no backend to upload a broken file to, so the app's job is to run
 * the file through its own parser locally, capture what a maintainer would need
 * to reproduce the bug, and hand the rider a prefilled GitHub issue to paste it
 * into — the same pattern `trackContribution.ts` uses for track submissions.
 *
 * Deliberately does not try to name which parser matched (`datalogParser.ts`'s
 * detection order is fragile and load-bearing — see CLAUDE.md Golden Rule 3b);
 * the channel list and rejected-row breakdown already narrow it down without
 * duplicating that logic.
 *
 * Kept free of React so it's unit-testable and costs nothing on the eager bundle.
 */

import type { ParserStats } from '@/types/racing';
import { parseDatalogFile } from './datalogParser';

export const DATA_ISSUE_REPO = 'beadon/RacePlex';
const ISSUE_TEMPLATE = 'data_import_issue.yml';

/** GitHub rejects an overly long URL — same threshold `trackContribution.ts` uses. */
const MAX_PREFILL_BYTES = 6000;

export interface DiagnosticReport {
  fileName: string;
  fileSizeBytes: number;
  generatedAt: string;
  success: boolean;
  /** Present only when `success` is false. */
  errorMessage?: string;
  /** Present only when `success` is true. */
  sampleCount?: number;
  durationMs?: number;
  channelNames?: string[];
  parserStats?: ParserStats;
  /** True when every sample's lat/lon is (0, 0) — a session with no real GPS fix. */
  boundsDegenerate?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Run `file` through the app's own parser and capture the result — success or
 * failure — as a diagnostic report. Never throws: a parse failure is the
 * expected case this exists to describe.
 */
export async function buildDiagnosticReport(file: File): Promise<DiagnosticReport> {
  const base = {
    fileName: file.name,
    fileSizeBytes: file.size,
    generatedAt: new Date().toISOString(),
  };
  try {
    const data = await parseDatalogFile(file);
    const boundsDegenerate =
      data.bounds.minLat === 0 && data.bounds.maxLat === 0 &&
      data.bounds.minLon === 0 && data.bounds.maxLon === 0;
    return {
      ...base,
      success: true,
      sampleCount: data.samples.length,
      durationMs: data.duration,
      channelNames: data.fieldMappings.map((f) => f.name),
      parserStats: data.parserStats,
      boundsDegenerate,
    };
  } catch (e) {
    return {
      ...base,
      success: false,
      errorMessage: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

/**
 * Render a report as plain text for the GitHub issue body. Never includes raw
 * sample rows or coordinates — counts and names only, so the auto-filled part
 * of a public issue carries no location data.
 */
export function formatDiagnosticReport(r: DiagnosticReport): string {
  const ext = r.fileName.includes('.') ? r.fileName.slice(r.fileName.lastIndexOf('.') + 1) : '(none)';
  const lines: string[] = [
    `File: ${r.fileName}`,
    `Size: ${formatBytes(r.fileSizeBytes)}`,
    `Extension: ${ext}`,
    `Report generated: ${r.generatedAt}`,
    '',
  ];

  if (!r.success) {
    lines.push('Result: parse FAILED');
    lines.push(`Error: ${r.errorMessage}`);
    return lines.join('\n');
  }

  lines.push('Result: parsed without error');
  lines.push(`Samples: ${r.sampleCount}`);
  if (r.durationMs != null) lines.push(`Duration: ${(r.durationMs / 1000).toFixed(1)} s`);
  lines.push(`GPS bounds: ${r.boundsDegenerate ? 'DEGENERATE — every sample is (0, 0)' : 'ok'}`);
  if (r.channelNames?.length) lines.push(`Channels (${r.channelNames.length}): ${r.channelNames.join(', ')}`);

  if (r.parserStats) {
    const s = r.parserStats;
    lines.push(`Rows accepted: ${s.acceptedRows} / ${s.totalRows}`);
    const rejected = Object.entries(s.rejected).filter(([, n]) => n > 0);
    if (rejected.length) {
      lines.push(`Rejected rows: ${rejected.map(([k, n]) => `${k}=${n}`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * URL for a prefilled data-issue GitHub issue. Falls back to an empty form
 * (rider pastes the report themselves, already on their clipboard) when the
 * report is too long for a URL — same fallback `trackContribution.ts` uses.
 */
export function dataIssueUrl(report: DiagnosticReport): { url: string; prefilled: boolean } {
  const base = `https://github.com/${DATA_ISSUE_REPO}/issues/new`;
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `Data issue: ${report.fileName}`,
  });

  const withBody = new URLSearchParams(params);
  withBody.set('diagnostic-report', formatDiagnosticReport(report));
  const candidate = `${base}?${withBody}`;

  if (candidate.length <= MAX_PREFILL_BYTES) {
    return { url: candidate, prefilled: true };
  }
  return { url: `${base}?${params}`, prefilled: false };
}
