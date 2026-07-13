import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Columns3, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getCsvMappingRequest,
  subscribeCsvMappingRequest,
  type CsvMappingRequest,
} from "@/lib/csvMappingRequest";
import {
  MAPPABLE_FIELDS,
  TIME_UNIT_LABELS,
  previewMapping,
  type CsvColumnMapping,
  type MappableField,
  type TimeUnit,
} from "@/lib/genericCsvParser";
import { SPEED_UNIT_LABELS, type SpeedUnit } from "@/lib/speedUnit";

/**
 * "We think these are your columns — are we right?"
 *
 * Shown when a CSV reaches the generic importer (i.e. no named parser claimed it), and only until
 * the rider confirms a mapping: the answer is remembered against a hash of the header row, so the
 * second ride off the same device imports silently. See lib/csvMappingRequest.ts for the
 * request/response channel and lib/csvMappingStorage.ts for the persistence.
 *
 * The PREVIEW is the reason this dialog exists rather than a silent auto-map. Time and speed units
 * cannot be recovered from a column name — `time` might be epoch ms or ms-since-midnight, `Speed`
 * might be m/s or km/h — and a wrong guess produces a ride that charts beautifully and is wrong.
 * A human reading "duration: 4h 00m" on a 40-second run catches in one second what no heuristic
 * can. So: show the numbers, and let them fix it.
 */

const FIELD_LABELS: Record<MappableField, string> = {
  lat: "Latitude",
  lon: "Longitude",
  time: "Time",
  speed: "Speed",
  altitude: "Altitude",
  heading: "Heading",
  accuracy: "GPS accuracy",
};

const REQUIRED: MappableField[] = ["lat", "lon"];

/** `-1` is a real value in the mapping ("not mapped"), so it needs a non-empty sentinel for Radix. */
const NONE = "__none__";

const DELIMITER_LABELS: Record<string, string> = {
  ",": "comma  ,",
  ";": "semicolon  ;",
  "\t": "tab",
  "|": "pipe  |",
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = Math.floor(s % 60);
  return h > 0 ? `${h}h ${m}m ${rest}s` : `${m}m ${rest}s`;
}

export function CsvMappingDialog() {
  const [request, setRequest] = useState<CsvMappingRequest | null>(getCsvMappingRequest());

  useEffect(() => subscribeCsvMappingRequest(setRequest), []);

  // The mapping form derives from the current request's proposal; a user edit
  // overrides it, stamped against the request identity so a fresh request
  // auto-resets the form to the proposal without a set-state-in-effect.
  const derivedMapping = request ? request.analysis.mapping : null;
  const [mappingOverride, setMappingOverride] = useState<{ home: CsvMappingRequest | null; value: CsvColumnMapping | null } | null>(null);
  const mapping = mappingOverride && mappingOverride.home === request ? mappingOverride.value : derivedMapping;
  const setMapping = (v: CsvColumnMapping | null) => setMappingOverride({ home: request, value: v });

  const analysis = request?.analysis;
  const table = analysis?.table;

  // Cheap enough to recompute on every change — which is the point. Flip the time unit and watch
  // the duration move.
  const preview = useMemo(
    () => (table && mapping ? previewMapping(table, mapping) : null),
    [table, mapping],
  );

  // The rider has to explicitly acknowledge the assumed km/h fallback before
  // Import unlocks. Setting the dropdown to any other value also counts as an
  // acknowledgement (they made an active choice). Issue #30 — the previous
  // flow was a click-through warning that a distracted rider could dismiss.
  const [ackAssumedUnit, setAckAssumedUnit] = useState(false);
  const initialAssumedSpeedUnit = analysis?.speedUnitSource === "assumed"
    ? analysis.mapping.speedUnit
    : null;
  const unitWasChangedFromAssumed =
    initialAssumedSpeedUnit !== null && mapping?.speedUnit !== initialAssumedSpeedUnit;
  const speedUnitConfirmed =
    initialAssumedSpeedUnit === null || unitWasChangedFromAssumed || ackAssumedUnit;

  if (!request || !analysis || !table || !mapping || !preview) return null;

  const set = (patch: Partial<CsvColumnMapping>) => setMapping({ ...mapping, ...patch });

  const missingRequired = REQUIRED.filter((f) => mapping[f] === -1);
  const canImport = missingRequired.length === 0 && preview.sampleCount > 0 && speedUnitConfirmed;

  const confidenceTone =
    analysis.confidence === "low"
      ? "border-warning/50 bg-warning/10 text-warning-foreground"
      : "border-border bg-muted/50 text-muted-foreground";

  return (
    <Dialog open onOpenChange={(open) => !open && request.cancel()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns3 className="h-5 w-5 text-primary" />
            Map this log&apos;s columns
          </DialogTitle>
          <DialogDescription>
            {request.fileName ? <span className="font-mono">{request.fileName}</span> : "This file"}{" "}
            isn&apos;t a format we recognise, so we read it as a plain table and guessed what each
            column means. <strong>Check the preview</strong> — a wrong time or speed unit still
            charts beautifully, it&apos;s just wrong. We&apos;ll remember your answer for this
            device.
          </DialogDescription>
        </DialogHeader>

        {/* What we found in the file. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Delimiter:{" "}
            <span className="font-mono text-foreground">
              {DELIMITER_LABELS[table.delimiter] ?? table.delimiter}
            </span>
          </span>
          <span>
            Columns: <span className="text-foreground">{table.columns.length}</span>
          </span>
          <span>
            Rows: <span className="text-foreground">{preview.rowCount}</span>
          </span>
          <span>
            GPS fixes: <span className="text-foreground">{preview.gpsFixCount}</span>
          </span>
          {table.comments.length > 0 && (
            <span className="font-mono">{table.comments[0]?.slice(0, 48)}</span>
          )}
        </div>

        {/* How we decided the two units that silently ruin an import. */}
        <div className={`space-y-1 rounded-md border px-3 py-2 text-xs ${confidenceTone}`}>
          <div className="flex items-center gap-1.5 font-medium">
            {analysis.confidence === "low" ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Info className="h-3.5 w-3.5" />
            )}
            {analysis.confidence === "low"
              ? "We had to guess at something — please check it"
              : "How we read this file"}
          </div>
          <ul className="list-inside list-disc space-y-0.5">
            {analysis.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* ── The mapping ── */}
          <div className="space-y-3">
            {MAPPABLE_FIELDS.map((field) => (
              <div key={field} className="space-y-1">
                <Label htmlFor={`csv-map-${field}`} className="text-xs">
                  {FIELD_LABELS[field]}
                  {REQUIRED.includes(field) && <span className="ml-1 text-destructive">*</span>}
                </Label>
                <Select
                  value={mapping[field] === -1 ? NONE : String(mapping[field])}
                  onValueChange={(v) => set({ [field]: v === NONE ? -1 : Number(v) })}
                >
                  <SelectTrigger id={`csv-map-${field}`} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {field === "speed" ? "Derive from GPS positions" : "Not in this file"}
                    </SelectItem>
                    {table.columns.map((col, i) => (
                      <SelectItem key={`${col}-${i}`} value={String(i)}>
                        {col}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}

            {mapping.time !== -1 && (
              <div className="space-y-1">
                <Label htmlFor="csv-map-time-unit" className="text-xs">
                  Time column means…
                </Label>
                <Select
                  value={mapping.timeUnit}
                  onValueChange={(v) => set({ timeUnit: v as TimeUnit })}
                >
                  <SelectTrigger id="csv-map-time-unit" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIME_UNIT_LABELS) as TimeUnit[])
                      .filter((u) => u !== "row_index")
                      .map((u) => (
                        <SelectItem key={u} value={u}>
                          {TIME_UNIT_LABELS[u]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {mapping.speed !== -1 && (
              <div className="space-y-1">
                <Label htmlFor="csv-map-speed-unit" className="text-xs">
                  Speed column is in…
                </Label>
                <Select
                  value={mapping.speedUnit}
                  onValueChange={(v) => set({ speedUnit: v as SpeedUnit })}
                >
                  <SelectTrigger id="csv-map-speed-unit" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SPEED_UNIT_LABELS) as SpeedUnit[]).map((u) => (
                      <SelectItem key={u} value={u}>
                        {SPEED_UNIT_LABELS[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Assumed-unit gate. The mapping couldn't measure this column
                    against GPS-derived speed (stationary log or too little
                    movement) and no header unit was found, so we defaulted to
                    km/h. Import is blocked until the rider either changes the
                    unit or explicitly confirms the guess — see issue #30. */}
                {analysis.speedUnitSource === "assumed" && !unitWasChangedFromAssumed && (
                  <label className="mt-2 flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-warning-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ackAssumedUnit}
                      onChange={(e) => setAckAssumedUnit(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-warning cursor-pointer"
                    />
                    <span>
                      <span className="font-medium">This unit is a guess.</span>{" "}
                      There's not enough movement in this log to measure it, and
                      the column name doesn't say. Pick the right unit above, or
                      tick this box to confirm km/h is correct.
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          {/* ── The preview: the whole reason this dialog exists. ── */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              With that mapping, this file reads as:
            </p>
            <dl className="space-y-1.5 rounded-md border border-border bg-card p-3 text-sm">
              <PreviewRow label="First timestamp" value={preview.firstTimestamp} mono />
              <PreviewRow
                label="Session duration"
                value={formatDuration(preview.durationMs)}
                emphasis
              />
              <PreviewRow
                label="Sample rate"
                value={`${preview.sampleRateHz.toFixed(1)} Hz`}
                emphasis
              />
              <PreviewRow label="Points" value={preview.sampleCount.toLocaleString()} />
              <PreviewRow
                label="First coordinate"
                value={
                  preview.firstCoord
                    ? `${preview.firstCoord.lat.toFixed(6)}, ${preview.firstCoord.lon.toFixed(6)}`
                    : "—"
                }
                mono
              />
              <PreviewRow
                label="Top speed"
                value={`${(preview.maxSpeedMps * 2.23694).toFixed(1)} mph  (${(
                  preview.maxSpeedMps * 3.6
                ).toFixed(1)} km/h)`}
              />
            </dl>

            <p className="text-xs text-muted-foreground">
              A run that lasted a minute but reads as four hours means the time unit is wrong. A
              20 mph ride that reads as 70 means the speed unit is.
            </p>

            {preview.extraColumns.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {preview.extraColumns.length} other column
                  {preview.extraColumns.length === 1 ? "" : "s"}
                </span>{" "}
                will ride along as telemetry channels:{" "}
                <span className="font-mono">{preview.extraColumns.slice(0, 8).join(", ")}</span>
                {preview.extraColumns.length > 8 && " …"}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <p className="self-center text-xs text-muted-foreground">
            {missingRequired.length > 0
              ? `Pick a column for ${missingRequired.map((f) => FIELD_LABELS[f]).join(" and ")}.`
              : preview.sampleCount === 0
                ? "No GPS fixes with this mapping — check the latitude/longitude columns."
                : !speedUnitConfirmed
                  ? "Confirm the assumed speed unit above before importing."
                  : "Saved against this file's column layout — you won't be asked again."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={request.cancel}>
              Cancel
            </Button>
            <Button disabled={!canImport} onClick={() => request.resolve(mapping)}>
              Import
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({
  label,
  value,
  mono,
  emphasis,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={[
          "text-right",
          mono ? "font-mono text-xs" : "text-sm",
          emphasis ? "font-semibold text-foreground" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
