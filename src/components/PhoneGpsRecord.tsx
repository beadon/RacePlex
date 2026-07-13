import { lazy, Suspense, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";

// The lap-timer tool already owns the phone-GPS capture + persistence loop.
// Lazy so the geolocation stack + tracks/GPS math don't ride the eager bundle.
const LapTimerTool = lazy(() =>
  import("@/plugins/tools/laptimer/LapTimerTool").then((m) => ({ default: m.default })),
);

const PRECISION_ACK_KEY = "phoneGps:precisionWarningAck";

interface PhoneGpsRecordProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Launches a phone-GPS recording session from the logger picker. Shows the
 * first-time precision warning (localStorage-remembered) before mounting the
 * real recording UI. On end, the lap-timer saves its `.dovep` log through the
 * same fileStorage path as any other device, tagged `source: 'phone-gps'` so
 * the session view shows a low-precision yield badge.
 */
function hasPrecisionAck(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PRECISION_ACK_KEY) === "1";
  } catch {
    return false;
  }
}

export function PhoneGpsRecord({ open, onClose }: PhoneGpsRecordProps) {
  const settings = useOptionalSettingsContext();
  const useKph = settings?.useKph ?? false;
  // Sticky "user acknowledged for this mount" — flipped by the Start button.
  // Combined with `open`, this derives which of the two dialogs is up without
  // an effect (React Compiler flags effect-driven state mirroring).
  const [ackedThisMount, setAckedThisMount] = useState(false);

  const alreadyAcked = hasPrecisionAck();
  const showRecorder = open && (alreadyAcked || ackedThisMount);
  const showWarning = open && !alreadyAcked && !ackedThisMount;

  const confirmAndStart = () => {
    try {
      localStorage.setItem(PRECISION_ACK_KEY, "1");
    } catch {
      // Private browsing / storage disabled — carry on; user just sees the
      // warning again next session.
    }
    setAckedThisMount(true);
  };

  const cancel = () => {
    setAckedThisMount(false);
    onClose();
  };

  return (
    <>
      <Dialog open={showWarning} onOpenChange={(o) => (!o ? cancel() : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>About phone GPS accuracy</DialogTitle>
            <DialogDescription>
              Your phone's built-in GPS updates ~1 Hz and is much less accurate
              than a dedicated logger (typically 5–10 m position error, low speed
              precision, no g-force). It's a great way to try RacePlex or to time
              a session when you don't have a logger yet — sessions recorded this
              way are flagged so you can tell them apart later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button onClick={confirmAndStart}>Start recording</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRecorder} onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="max-w-lg h-[85vh] sm:max-w-2xl p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle>Phone GPS recorder</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading recorder…</div>}>
              <LapTimerTool
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
    </>
  );
}
