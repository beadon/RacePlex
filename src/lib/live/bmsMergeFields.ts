/**
 * Fold a merged BMS reading (`concurrentCapture.ts`) into a primary device's
 * `GpsSample.extraFields` (issue #73) — mirrors `vescMergeFields.ts` exactly,
 * so a rider running GPS + VESC + BMS all at once gets three independent
 * sidecars merged into the same sample the same way.
 */
import type { FieldMapping, GpsSample } from "@/types/racing";
import type { MergedSample } from "./concurrentCapture";
import type { BmsSample } from "./bmsTransport";

export const BMS_FIELD_LABELS = {
  packVoltageV: "Pack Voltage (V)",
  packCurrentA: "Pack Current (A)",
  packSocPct: "Pack SOC (%)",
  packCycles: "Pack Cycles",
  mosfetTempC: "MOSFET Temp (C)",
  cellHighV: "Cell High (V)",
  cellLowV: "Cell Low (V)",
  cellAvgV: "Cell Avg (V)",
} as const;

/** Set (as 1) when this row's BMS pairing was stale beyond the merge threshold — never silently trusted. */
export const BMS_SUSPECT_LABEL = "BMS Sync Suspect";
/** Non-zero protection-status bits — a rider should be able to spot this in the chart, not just live. */
export const BMS_PROTECTION_LABEL = "BMS Protection";

/**
 * Mutates `extraFields` in place, adding whichever BMS channels are present
 * on `merged`. Call once per accepted primary sample, immediately after
 * pairing it via `ConcurrentSourceMerger.addPrimary()`.
 */
export function applyBmsMergeToExtraFields(
  extraFields: Record<string, number>,
  merged: MergedSample<unknown, BmsSample>,
): void {
  if (merged.secondary) {
    const { basicInfo, cellVoltages } = merged.secondary;
    extraFields[BMS_FIELD_LABELS.packVoltageV] = basicInfo.voltageV;
    extraFields[BMS_FIELD_LABELS.packCurrentA] = basicInfo.currentA;
    extraFields[BMS_FIELD_LABELS.packSocPct] = basicInfo.socPct;
    extraFields[BMS_FIELD_LABELS.packCycles] = basicInfo.cycles;
    // Index 0 confirmed as the MOSFET sensor on real hardware — see bmsDecoder.ts.
    if (basicInfo.tempsC.length > 0) extraFields[BMS_FIELD_LABELS.mosfetTempC] = basicInfo.tempsC[0];
    if (basicInfo.protectionStatus) extraFields[BMS_PROTECTION_LABEL] = basicInfo.protectionStatus;
    if (cellVoltages) {
      extraFields[BMS_FIELD_LABELS.cellHighV] = cellVoltages.highV;
      extraFields[BMS_FIELD_LABELS.cellLowV] = cellVoltages.lowV;
      extraFields[BMS_FIELD_LABELS.cellAvgV] = cellVoltages.avgV;
    }
  }
  // Set only on a stale pairing, never on "no BMS data at all" — those are
  // different things (see MergedSample.suspect's doc comment).
  if (merged.suspect) extraFields[BMS_SUSPECT_LABEL] = 1;
}

/**
 * Appends a `FieldMapping` for each BMS channel that actually appears
 * somewhere in `samples` — mirrors `vescMergeFields.ts`'s own "only list
 * channels that appeared" rule.
 */
export function appendBmsFieldMappings(fieldMappings: FieldMapping[], samples: GpsSample[]): void {
  const lowestIndex = fieldMappings.reduce((min, f) => Math.min(min, f.index), 0);
  let nextIndex = lowestIndex - 1;
  const has = (key: string) => samples.some((s) => s.extraFields[key] !== undefined);

  const channels: Array<{ label: string; enabled: boolean }> = [
    { label: BMS_FIELD_LABELS.packVoltageV, enabled: true },
    { label: BMS_FIELD_LABELS.packCurrentA, enabled: true },
    { label: BMS_FIELD_LABELS.packSocPct, enabled: true },
    { label: BMS_FIELD_LABELS.mosfetTempC, enabled: false },
    { label: BMS_FIELD_LABELS.cellHighV, enabled: false },
    { label: BMS_FIELD_LABELS.cellLowV, enabled: false },
    { label: BMS_FIELD_LABELS.cellAvgV, enabled: false },
    { label: BMS_FIELD_LABELS.packCycles, enabled: false },
    { label: BMS_PROTECTION_LABEL, enabled: false },
    { label: BMS_SUSPECT_LABEL, enabled: false },
  ];

  for (const { label, enabled } of channels) {
    if (has(label)) fieldMappings.push({ index: nextIndex--, name: label, enabled });
  }
}
