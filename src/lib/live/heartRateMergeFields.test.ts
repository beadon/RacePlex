import { describe, it, expect } from 'vitest';
import {
  applyHeartRateMergeToExtraFields,
  appendHeartRateFieldMappings,
  HEART_RATE_FIELD_LABELS,
  HEART_RATE_SUSPECT_LABEL,
} from './heartRateMergeFields';
import type { MergedSample } from './concurrentCapture';
import type { HeartRateSample } from './heartRateDecoder';
import type { GpsSample, FieldMapping } from '@/types/racing';

function heartRateSample(overrides: Partial<HeartRateSample> = {}): HeartRateSample {
  return { bpm: 142, rrIntervalMs: 420, contactDetected: true, ...overrides };
}

function merged(overrides: Partial<MergedSample<unknown, HeartRateSample>> = {}): MergedSample<unknown, HeartRateSample> {
  return { receivedAt: 1000, primary: null, secondary: heartRateSample(), suspect: false, secondaryAgeMs: 10, ...overrides };
}

describe('applyHeartRateMergeToExtraFields', () => {
  it('adds BPM and RR-interval when a secondary sample is present', () => {
    const extraFields: Record<string, number> = {};
    applyHeartRateMergeToExtraFields(extraFields, merged());
    expect(extraFields[HEART_RATE_FIELD_LABELS.bpm]).toBe(142);
    expect(extraFields[HEART_RATE_FIELD_LABELS.rrIntervalMs]).toBe(420);
  });

  it('does not add anything when there is no secondary sample yet', () => {
    const extraFields: Record<string, number> = {};
    applyHeartRateMergeToExtraFields(extraFields, merged({ secondary: null, suspect: false, secondaryAgeMs: null }));
    expect(Object.keys(extraFields)).toHaveLength(0);
  });

  it('omits the RR-interval channel when the device does not report one', () => {
    const extraFields: Record<string, number> = {};
    applyHeartRateMergeToExtraFields(extraFields, merged({ secondary: heartRateSample({ rrIntervalMs: undefined }) }));
    expect(extraFields[HEART_RATE_FIELD_LABELS.bpm]).toBe(142);
    expect(extraFields[HEART_RATE_FIELD_LABELS.rrIntervalMs]).toBeUndefined();
  });

  it('sets the suspect flag only when the pairing is flagged, never for "no data yet"', () => {
    const suspectFields: Record<string, number> = {};
    applyHeartRateMergeToExtraFields(suspectFields, merged({ suspect: true }));
    expect(suspectFields[HEART_RATE_SUSPECT_LABEL]).toBe(1);

    const noDataFields: Record<string, number> = {};
    applyHeartRateMergeToExtraFields(noDataFields, merged({ secondary: null, suspect: false, secondaryAgeMs: null }));
    expect(noDataFields[HEART_RATE_SUSPECT_LABEL]).toBeUndefined();
  });
});

describe('appendHeartRateFieldMappings', () => {
  function sample(extraFields: Record<string, number>): GpsSample {
    return { t: 0, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0, extraFields };
  }

  it('only lists channels that actually appear in the samples', () => {
    const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
    const samples = [sample({ [HEART_RATE_FIELD_LABELS.bpm]: 150 })];
    appendHeartRateFieldMappings(fieldMappings, samples);
    const names = fieldMappings.map((f) => f.name);
    expect(names).toContain(HEART_RATE_FIELD_LABELS.bpm);
    expect(names).not.toContain(HEART_RATE_FIELD_LABELS.rrIntervalMs);
  });

  it('assigns indices below the lowest existing index (no collision)', () => {
    const fieldMappings: FieldMapping[] = [
      { index: -1, name: 'Speed', enabled: true },
      { index: -8, name: 'Satellites', enabled: false },
    ];
    const samples = [sample({ [HEART_RATE_FIELD_LABELS.bpm]: 150, [HEART_RATE_FIELD_LABELS.rrIntervalMs]: 400 })];
    appendHeartRateFieldMappings(fieldMappings, samples);
    const indices = fieldMappings.map((f) => f.index);
    expect(new Set(indices).size).toBe(indices.length);
    expect(Math.min(...indices)).toBeLessThan(-8);
  });

  it('adds no heart-rate channels when no sample has any', () => {
    const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
    appendHeartRateFieldMappings(fieldMappings, [sample({})]);
    expect(fieldMappings).toHaveLength(1);
  });
});
