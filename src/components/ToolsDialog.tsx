import { lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Wrench } from "lucide-react";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";

/**
 * Dashboard entry point for the standalone tools (Stance nosedive calculator,
 * Seat Position CoG simulator, Phone Lap Timer). Reuses the exact same
 * `ToolsPanel` the in-session Tools tab shows — same picker, same tool
 * bodies, same behaviour — just hosted in a full-screen dialog instead of
 * inside a session's tab strip.
 *
 * Without this the tools were only reachable while a session was open — a
 * rider with no telemetry loaded couldn't get to the sliders. See the
 * feedback thread on the dashboard shell PR.
 */
const ToolsPanel = lazy(() => import("@/plugins/tools/ToolsPanel"));

interface ToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ToolsDialog({ open, onOpenChange }: ToolsDialogProps) {
  const settings = useOptionalSettingsContext();
  const useKph = settings?.useKph ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" />
            Tools
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading tools…</div>}>
            {/* ToolsPanel is a PluginPanelProps consumer; when there's no
                active session (which is why the dashboard is what mounted us)
                the tool bodies get null/empty props. The two calculator tools
                (Stance, Seat Position) ignore them entirely — they're pure
                sliders. The Lap Timer only reads `useKph` for its speedometer. */}
            <ToolsPanel
              data={null}
              laps={[]}
              selectedLapNumber={null}
              course={null}
              useKph={useKph}
              sessionSetup={null}
              activeSnapshot={null}
            />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
