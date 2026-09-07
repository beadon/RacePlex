import { describe, it, expect } from 'vitest';
import type { GpsSample, FieldMapping } from '@/types/racing';
import {
  buildLiveCaptureFileName,
  serializeLiveCapture,
  isLiveCaptureFormat,
  parseLiveCaptureFile,
  LIVE_CAPTURE_FORMAT_VERSION,
} from './liveCapturePackage';

function sample(t: number, lat: number, lon: number): GpsSample {
  return { t, lat, lon, speedMps: 10, speedMph: 22.4, speedKph: 36, extraFields: {} };
}

const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];

describe('buildLiveCaptureFileName', () => {
  it('encodes source kind and timestamp', () => {
    const name = buildLiveCaptureFileName({ kind: 'racebox' }, new Date(2026, 0, 5, 9, 3, 7));
    expect(name).toBe('racebox-20260105_090307.rplive');
  });

  it('slugifies a device name into the filename', () => {
    const name = buildLiveCaptureFileName(
      { kind: 'racebox', deviceName: 'RaceBox Micro 12AB' },
      new Date(2026, 0, 5, 9, 3, 7),
    );
    expect(name).toBe('racebox-racebox-micro-12ab-20260105_090307.rplive');
  });
});

describe('isLiveCaptureFormat', () => {
  it('matches only the .rplive extension, case-insensitively', () => {
    expect(isLiveCaptureFormat('racebox-20260105_090307.rplive')).toBe(true);
    expect(isLiveCaptureFormat('SESSION.RPLIVE')).toBe(true);
    expect(isLiveCaptureFormat('session.csv')).toBe(false);
  });
});

describe('serializeLiveCapture / parseLiveCaptureFile', () => {
  it('round-trips samples, field mappings, and start date', async () => {
    const samples = [sample(0, 28.4, -81.4), sample(1000, 28.401, -81.401)];
    const startDate = new Date('2026-01-05T09:03:07.000Z');
    const source = { kind: 'racebox' as const, deviceName: 'RaceBox Micro 12AB' };

    const blob = serializeLiveCapture({ samples, fieldMappings, startDate }, source);
    const buffer = await blob.arrayBuffer();
    const data = parseLiveCaptureFile(buffer);

    expect(data.samples).toEqual(samples);
    expect(data.fieldMappings).toEqual(fieldMappings);
    expect(data.startDate?.toISOString()).toBe(startDate.toISOString());
    expect(data.duration).toBe(1000);
    expect(data.bounds.minLat).toBeCloseTo(28.4);
    expect(data.bounds.maxLat).toBeCloseTo(28.401);
  });

  it('rejects a package with an unsupported format version', async () => {
    const pkg = {
      formatVersion: LIVE_CAPTURE_FORMAT_VERSION + 1,
      source: { kind: 'dragy' },
      samples: [],
      fieldMappings: [],
    };
    const buffer = new TextEncoder().encode(JSON.stringify(pkg)).buffer;
    expect(() => parseLiveCaptureFile(buffer)).toThrow(/unsupported/i);
  });

  it('rejects content that is not valid JSON', () => {
    const buffer = new TextEncoder().encode('not json').buffer;
    expect(() => parseLiveCaptureFile(buffer)).toThrow(/invalid json/i);
  });
});
