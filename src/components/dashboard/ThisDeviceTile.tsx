import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { detectDeviceModel } from "@/lib/deviceInfo";

interface ThisDeviceTileProps {
  /** Opens the phone-GPS recorder directly — no picker dialog in between. */
  onOpen: () => void;
}

/**
 * Promoted out of the "External Device" picker (issue #54): most riders try
 * RacePlex with their phone's own GPS before ever buying a logger, so it gets
 * equal top-level footing instead of being the last row in a Bluetooth-device
 * list, indistinguishable from hardware they don't own.
 */
export function ThisDeviceTile({ onOpen }: ThisDeviceTileProps) {
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectDeviceModel().then((m) => {
      if (!cancelled) setModel(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between hover:bg-muted/50 hover:border-primary/40 transition-colors"
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-primary" />
          This device
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {model
            ? `Record with ${model}'s built-in GPS — no logger needed.`
            : "Record with this device's built-in GPS — no logger needed."}
        </p>
      </div>
      <span className="mt-4 text-xs text-primary">Start recording →</span>
    </button>
  );
}
