/**
 * Fold a merged VESC reading (`concurrentCapture.ts`) into a primary
 * device's `GpsSample.extraFields` — shared by `RaceBoxLiveRecord.tsx` and
 * `DragyLiveRecord.tsx` so both wire up a VESC sidecar the same way (issue
 * #58). Labels match `vescCsvParser.ts`'s `ESC_CHANNELS` exactly, so a
 * merged live channel and a file-imported one look identical in the chart.
 */
import type { FieldMapping, GpsSample } from "@/types/racing";
import type { MergedSample } from "./concurrentCapture";
import type { VescValues } from "./vescDecoder";

export const VESC_FIELD_LABELS = {
  motorCurrentA: "Motor Current (A)",
  batteryCurrentA: "Battery Current (A)",
  batteryVoltageV: "Battery Voltage (V)",
  dutyCycle: "Duty Cycle",
  erpm: "ERPM",
  tempMotorC: "Motor Temp (C)",
  tempEscC: "ESC Temp (C)",
} as const;

/** Set (as 1) when this row's VESC pairing was stale beyond the merge threshold — never silently trusted. */
export const VESC_SUSPECT_LABEL = "VESC Sync Suspect";
export const VESC_FAULT_LABEL = "Fault Code";

/**
 * Mutates `extraFields` in place, adding whichever VESC channels are present
 * on `merged`. Call once per accepted primary sample, immediately after
 * pairing it via `ConcurrentSourceMerger.addPrimary()`.
 */
export function applyVescMergeToExtraFields(
  extraFields: Record<string, number>,
  merged: MergedSample<unknown, VescValues>,
): void {
  if (merged.secondary) {
    const v = merged.secondary;
    extraFields[VESC_FIELD_LABELS.motorCurrentA] = v.motorCurrentA;
    extraFields[VESC_FIELD_LABELS.batteryCurrentA] = v.batteryCurrentA;
    extraFields[VESC_FIELD_LABELS.batteryVoltageV] = v.batteryVoltageV;
    extraFields[VESC_FIELD_LABELS.dutyCycle] = v.dutyCycle;
    extraFields[VESC_FIELD_LABELS.erpm] = v.erpm;
    extraFields[VESC_FIELD_LABELS.tempMotorC] = v.tempMotorC;
    extraFields[VESC_FIELD_LABELS.tempEscC] = v.tempEscC;
    if (v.faultCode) extraFields[VESC_FAULT_LABEL] = v.faultCode;
  }
  // Set only on a stale pairing, never on "no VESC data at all" — those are
  // different things (see MergedSample.suspect's doc comment).
  if (merged.suspect) extraFields[VESC_SUSPECT_LABEL] = 1;
}

/**
 * Appends a `FieldMapping` for each VESC channel that actually appears
 * somewhere in `samples` — mirrors `vescCsvParser.ts`'s own "only list
 * channels that appeared" rule, since a channel with zero real values would
 * just be a confusing all-blank row in the chart.
 */
export function appendVescFieldMappings(fieldMappings: FieldMapping[], samples: GpsSample[]): void {
  const lowestIndex = fieldMappings.reduce((min, f) => Math.min(min, f.index), 0);
  let nextIndex = lowestIndex - 1;
  const has = (key: string) => samples.some((s) => s.extraFields[key] !== undefined);

  const primaryChannels: Array<{ label: string; enabled: boolean }> = [
    { label: VESC_FIELD_LABELS.motorCurrentA, enabled: true },
    { label: VESC_FIELD_LABELS.batteryCurrentA, enabled: true },
    { label: VESC_FIELD_LABELS.batteryVoltageV, enabled: true },
    { label: VESC_FIELD_LABELS.dutyCycle, enabled: true },
    { label: VESC_FIELD_LABELS.erpm, enabled: false },
    { label: VESC_FIELD_LABELS.tempMotorC, enabled: false },
    { label: VESC_FIELD_LABELS.tempEscC, enabled: false },
    { label: VESC_FAULT_LABEL, enabled: false },
    { label: VESC_SUSPECT_LABEL, enabled: false },
  ];

  for (const { label, enabled } of primaryChannels) {
    if (has(label)) fieldMappings.push({ index: nextIndex--, name: label, enabled });
  }
}
