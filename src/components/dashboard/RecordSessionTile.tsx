import { Radio } from "lucide-react";

interface RecordSessionTileProps {
  onOpen: () => void;
}

/**
 * Entry point for a fresh recording (issue #43): opens `RecordingModeDialog`,
 * which asks what kind of session this is (Simple / Drag Race / Track) before
 * asking how — This Device or External Device. Replaces separate top-level
 * device tiles so the classification is asked up front, not skippable.
 */
export function RecordSessionTile({ onOpen }: RecordSessionTileProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between hover:bg-muted/50 hover:border-primary/40 transition-colors"
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          Record a session
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          This phone, or a Bluetooth/wired logger — simple, drag race, or track.
        </p>
      </div>
      <span className="mt-4 text-xs text-primary">Start →</span>
    </button>
  );
}
