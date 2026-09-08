import { describe, it, expect } from 'vitest';
import {
  applyBmsMergeToExtraFields,
  appendBmsFieldMappings,
  BMS_FIELD_LABELS,
  BMS_SUSPECT_LABEL,
  BMS_PROTECTION_LABEL,
} from './bmsMergeFields';
import type { MergedSample } from './concurrentCapture';
import type { BmsSample } from './bmsTransport';
import type { BmsBasicInfo, BmsCellVoltages } from './bmsDecoder';
import type { GpsSample, FieldMapping } from '@/types/racing';

function basicInfo(overrides: Partial<BmsBasicInfo> = {}): BmsBasicInfo {
  return {
    voltageV: 47.58, currentA: 5.07, remainAh: 20, nominalAh: 20, cycles: 0, socPct: 100,
    chargeFetOn: true, dischargeFetOn: true, numCells: 12, numTemps: 3,
    tempsC: [33.0, 28.4, 28.1], protectionStatus: 0, balanceStatus: 0,
    ...overrides,
  };
}

function cellVoltages(overrides: Partial<BmsCellVoltages> = {}): BmsCellVoltages {
  return { cellsV: Array(12).fill(3.965), highV: 3.968, lowV: 3.962, avgV: 3.965, diffV: 0.006, ...overrides };
}

function bmsSample(overrides: Partial<BmsSample> = {}): BmsSample {
  return { basicInfo: basicInfo(), cellVoltages: cellVoltages(), ...overrides };
}

function merged(overrides: Partial<MergedSample<unknown, BmsSample>> = {}): MergedSample<unknown, BmsSample> {
  return { receivedAt: 1000, primary: null, secondary: bmsSample(), suspect: false, secondaryAgeMs: 10, ...overrides };
}

describe('applyBmsMergeToExtraFields', () => {
  it('adds every BMS channel when a secondary sample is present', () => {
    const extraFields: Record<string, number> = {};
    applyBmsMergeToExtraFields(extraFields, merged());
    expect(extraFields[BMS_FIELD_LABELS.packVoltageV]).toBe(47.58);
    expect(extraFields[BMS_FIELD_LABELS.packCurrentA]).toBe(5.07);
    expect(extraFields[BMS_FIELD_LABELS.packSocPct]).toBe(100);
    expect(extraFields[BMS_FIELD_LABELS.packCycles]).toBe(0);
    expect(extraFields[BMS_FIELD_LABELS.mosfetTempC]).toBe(33.0);
    expect(extraFields[BMS_FIELD_LABELS.cellHighV]).toBe(3.968);
    expect(extraFields[BMS_FIELD_LABELS.cellLowV]).toBe(3.962);
    expect(extraFields[BMS_FIELD_LABELS.cellAvgV]).toBe(3.965);
  });

  it('does not add anything when there is no secondary sample yet', () => {
    const extraFields: Record<string, number> = {};
    applyBmsMergeToExtraFields(extraFields, merged({ secondary: null, suspect: false, secondaryAgeMs: null }));
    expect(Object.keys(extraFields)).toHaveLength(0);
  });

  it('omits cell-voltage channels when only basic info has arrived so far', () => {
    const extraFields: Record<string, number> = {};
    applyBmsMergeToExtraFields(extraFields, merged({ secondary: bmsSample({ cellVoltages: null }) }));
    expect(extraFields[BMS_FIELD_LABELS.packVoltageV]).toBe(47.58);
    expect(extraFields[BMS_FIELD_LABELS.cellHighV]).toBeUndefined();
  });

  it('sets the suspect flag only when the pairing is flagged, never for "no data yet"', () => {
    const suspectFields: Record<string, number> = {};
    applyBmsMergeToExtraFields(suspectFields, merged({ suspect: true }));
    expect(suspectFields[BMS_SUSPECT_LABEL]).toBe(1);

    const noDataFields: Record<string, number> = {};
    applyBmsMergeToExtraFields(noDataFields, merged({ secondary: null, suspect: false, secondaryAgeMs: null }));
    expect(noDataFields[BMS_SUSPECT_LABEL]).toBeUndefined();
  });

  it('carries a non-zero protection status but omits it when there is none', () => {
    const withProtection: Record<string, number> = {};
    applyBmsMergeToExtraFields(withProtection, merged({ secondary: bmsSample({ basicInfo: basicInfo({ protectionStatus: 4 }) }) }));
    expect(withProtection[BMS_PROTECTION_LABEL]).toBe(4);

    const noProtection: Record<string, number> = {};
    applyBmsMergeToExtraFields(noProtection, merged({ secondary: bmsSample({ basicInfo: basicInfo({ protectionStatus: 0 }) }) }));
    expect(noProtection[BMS_PROTECTION_LABEL]).toBeUndefined();
  });
});

describe('appendBmsFieldMappings', () => {
  function sample(extraFields: Record<string, number>): GpsSample {
    return { t: 0, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0, extraFields };
  }

  it('only lists channels that actually appear in the samples', () => {
    const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
    const samples = [sample({ [BMS_FIELD_LABELS.packVoltageV]: 47 })];
    appendBmsFieldMappings(fieldMappings, samples);
    const names = fieldMappings.map((f) => f.name);
    expect(names).toContain(BMS_FIELD_LABELS.packVoltageV);
    expect(names).not.toContain(BMS_FIELD_LABELS.cellHighV);
  });

  it('assigns indices below the lowest existing index (no collision)', () => {
    const fieldMappings: FieldMapping[] = [
      { index: -1, name: 'Speed', enabled: true },
      { index: -8, name: 'Satellites', enabled: false },
    ];
    const samples = [sample({ [BMS_FIELD_LABELS.packVoltageV]: 47, [BMS_FIELD_LABELS.packCurrentA]: 5 })];
    appendBmsFieldMappings(fieldMappings, samples);
    const indices = fieldMappings.map((f) => f.index);
    expect(new Set(indices).size).toBe(indices.length); // all unique
    expect(Math.min(...indices)).toBeLessThan(-8);
  });

  it('adds no BMS channels when no sample has any', () => {
    const fieldMappings: FieldMapping[] = [{ index: -1, name: 'Speed', enabled: true }];
    appendBmsFieldMappings(fieldMappings, [sample({})]);
    expect(fieldMappings).toHaveLength(1);
  });
});
