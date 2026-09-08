/**
 * Small pills showing whether a session carries VESC and/or BMS sidecar data
 * (issues #58, #73), so a rider can tell at a glance in a session list without
 * opening each one. Mirrors `FileTypeBadge`'s exact styling. Renders nothing
 * when neither is present — the common case.
 */
export function SidecarDataChips({ hasVescData, hasBmsData }: { hasVescData?: boolean; hasBmsData?: boolean }) {
  if (!hasVescData && !hasBmsData) return null;
  return (
    <>
      {hasVescData && (
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
          title="This session includes VESC telemetry"
        >
          VESC
        </span>
      )}
      {hasBmsData && (
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
          title="This session includes BMS telemetry"
        >
          BMS
        </span>
      )}
    </>
  );
}
