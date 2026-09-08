/**
 * Fold a merged heart-rate reading (`concurrentCapture.ts`) into a primary
 * device's `GpsSample.extraFields` (issue #87) — mirrors
 * `vescMergeFields.ts`/`bmsMergeFields.ts` exactly.
 *
 * The BPM channel is named "Heart Rate" to match `fitParser.ts`'s existing
 * label for the same data read out of an imported `.FIT` file, so a live
 * capture and an imported ride look identical in the chart.
 */
import type { FieldMapping, GpsSample } from "@/types/racing";
import type { MergedSample } from "./concurrentCapture";
import type { HeartRateSample } from "./heartRateDecoder";

export const HEART_RATE_FIELD_LABELS = {
  bpm: "Heart Rate",
  rrIntervalMs: "HR RR Interval (ms)",
} as const;

/** Set (as 1) when this row's heart-rate pairing was stale beyond the merge threshold. */
export const HEART_RATE_SUSPECT_LABEL = "HR Sync Suspect";

/**
 * Mutates `extraFields` in place, adding whichever heart-rate channels are
 * present on `merged`. Call once per accepted primary sample, immediately
 * after pairing it via `ConcurrentSourceMerger.addPrimary()`.
 */
export function applyHeartRateMergeToExtraFields(
  extraFields: Record<string, number>,
  merged: MergedSample<unknown, HeartRateSample>,
): void {
  if (merged.secondary) {
    const hr = merged.secondary;
    extraFields[HEART_RATE_FIELD_LABELS.bpm] = hr.bpm;
    if (hr.rrIntervalMs != null) extraFields[HEART_RATE_FIELD_LABELS.rrIntervalMs] = hr.rrIntervalMs;
  }
  if (merged.suspect) extraFields[HEART_RATE_SUSPECT_LABEL] = 1;
}

/**
 * Appends a `FieldMapping` for each heart-rate channel that actually appears
 * somewhere in `samples` — mirrors `vescMergeFields.ts`'s own "only list
 * channels that appeared" rule.
 */
export function appendHeartRateFieldMappings(fieldMappings: FieldMapping[], samples: GpsSample[]): void {
  const lowestIndex = fieldMappings.reduce((min, f) => Math.min(min, f.index), 0);
  let nextIndex = lowestIndex - 1;
  const has = (key: string) => samples.some((s) => s.extraFields[key] !== undefined);

  const channels: Array<{ label: string; enabled: boolean }> = [
    { label: HEART_RATE_FIELD_LABELS.bpm, enabled: true },
    { label: HEART_RATE_FIELD_LABELS.rrIntervalMs, enabled: false },
    { label: HEART_RATE_SUSPECT_LABEL, enabled: false },
  ];

  for (const { label, enabled } of channels) {
    if (has(label)) fieldMappings.push({ index: nextIndex--, name: label, enabled });
  }
}
