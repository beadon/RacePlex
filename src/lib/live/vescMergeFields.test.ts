import { describe, it, expect } from 'vitest';
import {
  applyVescMergeToExtraFields,
  appendVescFieldMappings,
  VESC_FIELD_LABELS,
  VESC_SUSPECT_LABEL,
  VESC_FAULT_LABEL,
} from './vescMergeFields';
import type { MergedSample } from './concurrentCapture';
import type { VescValues } from './vescDecoder';
import type { GpsSample, FieldMapping } from '@/types/racing';

function vescValues(overrides: Partial<VescValues> = {}): VescValues {
  return {
    tempEscC: 40, tempMotorC: 35, motorCurrentA: 10, batteryCurrentA: 8,
    dutyCycle: 0.5, erpm: 10_000, batteryVoltageV: 42, ampHours: 1, faultCode: 0,
    ...overrides,
  };
}

function merged(overrides: Partial<MergedSample<unknown, VescValues>> = {}): MergedSample<unknown, VescValues> {
  return { receivedAt: 1000, primary: null, secondary: vescValues(), suspect: false, secondaryAgeMs: 10, ...overrides };
}

describe('applyVescMergeToExtraFields', () => {
  it('adds every VESC channel when a secondary sample is present', () => {
    const extraFields: Record<string, number> = {};
    applyVescMergeToExtraFields(extraFields, merged());
    expect(extraFields[VESC_FIELD_LABELS.motorCurrentA]).toBe(10);
    expect(extraFields[VESC_FIELD_LABELS.batteryCurrentA]).toBe(8);
    expect(extraFields[VESC_FIELD_LABELS.batteryVoltageV]).toBe(42);
    expect(extraFields[VESC_FIELD_LABELS.dutyCycle]).toBe(0.5);
    expect(extraFields[VESC_FIELD_LABELS.erpm]).toBe(10_000);
    expect(extraFields[VESC_FIELD_LABELS.tempMotorC]).toBe(35);
    expect(extraFields[VESC_FIELD_LABELS.tempEscC]).toBe(40);
  });

  it('does not add anything when there is no secondary sample yet', () => {
    const extraFields: Record<string, number> = {};
    applyVescMergeToExtraFields(extraFields, merged({ secondary: null, suspect: false, secondaryAgeMs: null }));
    expect(Object.keys(extraFields)).toHaveLength(0);
  });

  it('sets the suspect flag only when the pairing is flagged, never for "no data yet"', () => {
    const suspectFields: Record<string, number> = {};
    applyVescMergeToExtraFields(suspectFields, merged({ suspect: true }));
    expect(suspectFields[VESC_SUSPECT_LABEL]).toBe(1);

    const noDataFields: Record<string, number> = {};
    applyVescMergeToExtraFields(noDataFields, merged({ secondary: null, suspect: false, secondaryAgeMs: null }));
    expect(noDataFields[VESC_SUSPECT_LABEL]).toBeUndefined();
  });

  it('carries a non-zero fault code but omits it when there is none', () => {
    const withFault: Record<string, number> = {};
    applyVescMergeToExtraFields(withFault, merged({ secondary: vescValues({ faultCode: 5 }) }));
    expect(withFault[VESC_FAULT_LABEL]).toBe(5);

    const noFault: Record<string, number> = {};
    applyVescMergeToExtraFields(noFault, merged({ secondary: vescValues({ faultCode: 0 }) }));
    expect(noFault[VESC_FAULT_LABEL]).toBeUndefined();
  });
});

describe('appendVescFieldMappings', () => {
  function sample(extraFields: Record<string, number>): GpsSample {
    return { t: 0, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0, extraFields };
  }

  it('only lists channels that actually appear in the samples', () => {
    const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
    const samples = [sample({ [VESC_FIELD_LABELS.motorCurrentA]: 5 })];
    appendVescFieldMappings(fieldMappings, samples);
    const names = fieldMappings.map((f) => f.name);
    expect(names).toContain(VESC_FIELD_LABELS.motorCurrentA);
    expect(names).not.toContain(VESC_FIELD_LABELS.erpm);
  });

  it('assigns indices below the lowest existing index (no collision)', () => {
    const fieldMappings: FieldMapping[] = [
      { index: -1, name: 'Speed', enabled: true },
      { index: -8, name: 'Satellites', enabled: false },
    ];
    const samples = [sample({ [VESC_FIELD_LABELS.motorCurrentA]: 5, [VESC_FIELD_LABELS.dutyCycle]: 0.3 })];
    appendVescFieldMappings(fieldMappings, samples);
    const indices = fieldMappings.map((f) => f.index);
    expect(new Set(indices).size).toBe(indices.length); // all unique
    expect(Math.min(...indices)).toBeLessThan(-8);
  });

  it('adds no VESC channels when no sample has any', () => {
    const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
    appendVescFieldMappings(fieldMappings, [sample({})]);
    expect(fieldMappings).toHaveLength(1);
  });
});
