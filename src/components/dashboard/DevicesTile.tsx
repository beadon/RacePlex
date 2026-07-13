import { Bluetooth } from "lucide-react";

interface DevicesTileProps {
  /** Fires the LoggerDownload picker (wired by the parent — the picker itself
   *  lives in LoggerDownload/LoggerPicker and needs to stay eager on mount so
   *  the menu opens instantly). */
  onOpen: () => void;
}

/**
 * Simple entry-point tile for a fresh logger download. Deliberately doesn't
 * try to list connected devices: our BLE stack is spec'd for the DovesData /
 * Fledgling logger and web BLE has no "list previously seen devices" API in
 * standard browsers. When native (Tauri) IPC lands more device kinds, this
 * tile can grow into a real inventory.
 */
export function DevicesTile({ onOpen }: DevicesTileProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between hover:bg-muted/50 hover:border-primary/40 transition-colors"
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bluetooth className="w-4 h-4 text-primary" />
          Devices
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Download logs straight off a datalogger over Bluetooth or the wired connection.
        </p>
      </div>
      <span className="mt-4 text-xs text-primary">Connect a device →</span>
    </button>
  );
}
