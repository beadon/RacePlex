import { describe, it, expect } from 'vitest';
import { buildDiagnosticReport, formatDiagnosticReport, dataIssueUrl } from './dataIssueReport';

// A minimally-valid Dove CSV — same shape used by datalogRouter.test.ts — is
// enough to exercise the success path without pulling in a real sample file.
const T0 = 1_614_700_000_000;
function doveCsv(rows = 4): string {
  const lines = ['timestamp,sats,hdop,lat,lng,speed_mph,heading_deg,rpm'];
  for (let i = 0; i < rows; i++) {
    lines.push(`${T0 + i * 100},12,0.9,28.401,${-81.401 + i * 0.00001},${30 + i},90,5000`);
  }
  return lines.join('\n');
}

describe('buildDiagnosticReport', () => {
  it('captures a successful parse without any raw coordinates', async () => {
    const file = new File([doveCsv()], 'session.dove');
    const report = await buildDiagnosticReport(file);

    expect(report.success).toBe(true);
    expect(report.fileName).toBe('session.dove');
    expect(report.sampleCount).toBe(4);
    expect(report.boundsDegenerate).toBe(false);
    expect(report.channelNames?.length).toBeGreaterThan(0);

    const text = formatDiagnosticReport(report);
    expect(text).not.toContain('28.401');
    expect(text).not.toContain('-81.401');
  });

  it('captures a thrown parse error instead of throwing', async () => {
    const file = new File([''], 'empty.csv');
    const report = await buildDiagnosticReport(file);

    expect(report.success).toBe(false);
    expect(report.errorMessage).toMatch(/empty file/i);

    const text = formatDiagnosticReport(report);
    expect(text).toContain('parse FAILED');
    expect(text).toContain('Empty file');
  });
});

describe('dataIssueUrl', () => {
  it('prefills the issue body when the report is short', async () => {
    const file = new File([doveCsv()], 'session.dove');
    const report = await buildDiagnosticReport(file);
    const { url, prefilled } = dataIssueUrl(report);

    expect(prefilled).toBe(true);
    expect(url).toContain('github.com/beadon/RacePlex/issues/new');
    expect(url).toContain('template=data_import_issue.yml');
    expect(url).toContain(encodeURIComponent('session.dove'));
  });

  it('falls back to an empty form when the report would blow the URL budget', () => {
    const report = {
      fileName: 'huge.csv',
      fileSizeBytes: 123,
      generatedAt: new Date().toISOString(),
      success: true as const,
      sampleCount: 1,
      durationMs: 1000,
      channelNames: Array.from({ length: 2000 }, (_, i) => `custom:field_${i}`),
      boundsDegenerate: false,
    };
    const { url, prefilled } = dataIssueUrl(report);
    expect(prefilled).toBe(false);
    expect(url).not.toContain('diagnostic-report');
  });
});
