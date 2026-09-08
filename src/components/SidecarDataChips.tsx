/**
 * Small pills showing whether a session carries VESC, BMS, and/or heart-rate
 * sidecar data (issues #58, #73, #87), so a rider can tell at a glance in a
 * session list without opening each one. Mirrors `FileTypeBadge`'s exact
 * styling. Renders nothing when none are present — the common case.
 */
export function SidecarDataChips({
  hasVescData,
  hasBmsData,
  hasHeartRateData,
}: {
  hasVescData?: boolean;
  hasBmsData?: boolean;
  hasHeartRateData?: boolean;
}) {
  if (!hasVescData && !hasBmsData && !hasHeartRateData) return null;
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
      {hasHeartRateData && (
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
          title="This session includes heart-rate data"
        >
          HR
        </span>
      )}
    </>
  );
}
