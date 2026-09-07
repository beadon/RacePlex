import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Gauge, Timer, MapPin, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoggerDownload } from "@/components/LoggerDownload";
import { DevicesTile } from "@/components/dashboard/DevicesTile";
import { ThisDeviceTile } from "@/components/dashboard/ThisDeviceTile";
import { updateFileMetadata, type FileMetadata } from "@/lib/fileStorage";
import type { ParsedData } from "@/types/racing";

export type SessionType = NonNullable<FileMetadata["sessionType"]>;

interface ModeOption {
  type: SessionType;
  name: string;
  tag: string;
  icon: typeof Gauge;
}

// Order matters for the "first-time rider" default read: the plain option
// first, the two specialized ones after.
const MODE_OPTIONS: ModeOption[] = [
  {
    type: "simple",
    name: "Simple logger",
    tag: "Just record — pick a track and analyze laps afterward, or don't.",
    icon: Gauge,
  },
  {
    type: "drag",
    name: "Drag race logger",
    tag: "Straight-line runs — 0-60, quarter mile, trap speed.",
    icon: Timer,
  },
  {
    type: "track",
    name: "Track logger",
    tag: "Circuit or point-to-point lap timing.",
    icon: MapPin,
  },
];

type Step = "mode" | "setup" | "device";

interface RecordingModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
}

/**
 * "What are you recording?" — chosen before picking a device (issue #43), so
 * the resulting session carries a `sessionType` classification a future
 * display can use to surface the metrics a rider actually cares about
 * (lap times for a track session, 0-60/quarter-mile for a drag run) instead
 * of showing everything regardless of relevance.
 *
 * Reuses `LoggerDownload` as-is for the actual capture — it already owns the
 * lazy-mounted device/phone-GPS flows and their `saveFileMetadata` calls;
 * this dialog only needs to stamp `sessionType` onto the finished file once
 * `onDataLoaded` fires, via `updateFileMetadata` (read-merge-write, so it
 * never clobbers what the capture flow already wrote).
 */
export function RecordingModeDialog({
  open,
  onOpenChange,
  onDataLoaded,
  autoSave,
  autoSaveFile,
}: RecordingModeDialogProps) {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<SessionType | null>(null);

  const reset = useCallback(() => {
    setStep("mode");
    setMode(null);
  }, []);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const selectMode = (type: SessionType) => {
    setMode(type);
    setStep("setup");
  };

  // The capture flows (RaceBoxLiveRecord, PhoneGpsRecord, …) each save their
  // own file + metadata before calling onDataLoaded — this only adds the
  // classification on top, and closes the mode dialog so it doesn't sit
  // behind whichever flow's own dialog is now showing the finished session.
  const handleDataLoaded = useCallback(
    (data: ParsedData, fileName?: string) => {
      onOpenChange(false);
      reset();
      onDataLoaded(data, fileName);
      if (fileName && mode) {
        void updateFileMetadata(fileName, { sessionType: mode });
      }
    },
    [mode, onDataLoaded, onOpenChange, reset],
  );

  const selected = MODE_OPTIONS.find((m) => m.type === mode);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "mode" && (
          <>
            <DialogHeader>
              <DialogTitle>What are you recording?</DialogTitle>
              <DialogDescription>
                This just tags the session — you can record any way regardless of what you pick.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              {MODE_OPTIONS.map(({ type, name, tag, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectMode(type)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors",
                    "hover:border-primary/50 hover:bg-accent",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground">{name}</div>
                    <div className="text-xs text-muted-foreground">{tag}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "setup" && selected && (
          <>
            <DialogHeader>
              <DialogTitle>{selected.name}</DialogTitle>
            </DialogHeader>
            {mode === "drag" && (
              <p className="text-sm text-muted-foreground">
                0-60, quarter-mile and trap speed need a lot more precision than lap timing does.
                A 1 Hz source (a phone, or a FIT-logging watch) puts a fix every ~27 m at 60 mph —
                the times will be rough estimates. For results worth comparing, use a 10-25 Hz
                logger like a RaceBox or Dragy.
              </p>
            )}
            {mode === "track" && (
              <p className="text-sm text-muted-foreground">
                No need to pick a track now — RacePlex detects it (and the course) automatically
                once the session has GPS data to match against.
              </p>
            )}
            {mode === "simple" && (
              <p className="text-sm text-muted-foreground">
                Nothing else to set up — pick how you're recording and go.
              </p>
            )}
            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("mode")}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Button>
              <Button size="sm" onClick={() => setStep("device")}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === "device" && (
          <>
            <DialogHeader>
              <DialogTitle>How are you recording?</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              <LoggerDownload
                onDataLoaded={handleDataLoaded}
                autoSave={autoSave}
                autoSaveFile={autoSaveFile}
                hidePhoneGpsInPicker
                renderPhoneTrigger={({ onOpen }) => <ThisDeviceTile onOpen={onOpen} />}
                renderTrigger={({ onOpen }) => <DevicesTile onOpen={onOpen} />}
              />
            </div>
            <Button variant="ghost" size="sm" className="w-fit justify-self-start" onClick={() => setStep("setup")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
