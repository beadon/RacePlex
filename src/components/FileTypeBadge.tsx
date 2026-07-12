import { logFileTypeLabel } from "@/lib/logFileType";

/**
 * A small pill showing a log file's format, derived from its extension. Renders
 * nothing when the name has no extension. Used in the file browser rows so each
 * session (shown by date/time) still says what kind of log it is.
 */
export function FileTypeBadge({ fileName, className }: { fileName: string; className?: string }) {
  const label = logFileTypeLabel(fileName);
  if (!label) return null;
  return (
    <span
      className={`shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground ${className ?? ""}`}
      title={`${label} log file`}
    >
      {label}
    </span>
  );
}
