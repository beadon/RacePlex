import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatLapTime } from "@/lib/lapCalculation";
import type { Lap, ParsedData } from "@/types/racing";

type SessionRecord =
  | { fileName: string; status: "loading" }
  | { fileName: string; status: "error"; error: string }
  | { fileName: string; status: "ready"; data: ParsedData; laps: Lap[]; selectedLap: Lap | null };

interface ComparisonSessionBarProps {
  sessions: readonly SessionRecord[];
  onRemove: (fileName: string) => void;
  onLapChange: (fileName: string, lap: Lap | null) => void;
  colourFor: (fileName: string) => string;
}

/**
 * One row per staged session: colour swatch, name, lap picker (fastest by
 * default), remove button. Compact — the meat of the page is the charts
 * below.
 */
export function ComparisonSessionBar({
  sessions,
  onRemove,
  onLapChange,
  colourFor,
}: ComparisonSessionBarProps) {
  return (
    <div className="rounded-md border border-border bg-card divide-y divide-border">
      {sessions.map((s) => (
        <div key={s.fileName} className="flex items-center gap-3 px-3 py-2">
          <span
            className="inline-block h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: colourFor(s.fileName) }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground truncate">{s.fileName}</div>
            {s.status === "loading" && (
              <div className="text-xs text-muted-foreground">Loading…</div>
            )}
            {s.status === "error" && (
              <div className="text-xs text-destructive">{s.error}</div>
            )}
            {s.status === "ready" && (
              <div className="text-xs text-muted-foreground">
                {s.laps.length === 0
                  ? "No laps detected"
                  : `${s.laps.length} lap${s.laps.length === 1 ? "" : "s"}`}
              </div>
            )}
          </div>

          {s.status === "ready" && s.laps.length > 0 && (
            <Select
              value={s.selectedLap ? String(s.selectedLap.lapNumber) : "none"}
              onValueChange={(v) => {
                if (v === "none") return onLapChange(s.fileName, null);
                const picked = s.laps.find((l) => l.lapNumber === Number(v)) ?? null;
                onLapChange(s.fileName, picked);
              }}
            >
              <SelectTrigger className="h-8 text-xs w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {s.laps.map((lap) => (
                  <SelectItem key={lap.lapNumber} value={String(lap.lapNumber)}>
                    Lap {lap.lapNumber} · {formatLapTime(lap.lapTimeMs)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-60 hover:opacity-100"
            onClick={() => onRemove(s.fileName)}
            title="Remove from comparison"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
