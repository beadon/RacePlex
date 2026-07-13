import { useState } from "react";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileImport } from "@/components/FileImport";
import type { ParsedData } from "@/types/racing";

interface ImportTileProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
}

/**
 * Compact dashboard tile for importing a datalog. Keeps equal visual weight
 * with the other quick-action tiles (Garage / Tracks / Devices) — the full
 * FileImport dropzone opens inside a modal on click. Returning users spend
 * most of their time on Recent Sessions above; import is one option among
 * several, not the page's hero.
 */
export function ImportTile({ onDataLoaded, autoSave, autoSaveFile }: ImportTileProps) {
  const [open, setOpen] = useState(false);

  // Close the dialog on successful load so the session view takes over
  // without the modal lingering.
  const handleDataLoaded = (data: ParsedData, fileName?: string) => {
    setOpen(false);
    onDataLoaded(data, fileName);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left rounded-lg border border-border bg-card/50 p-4 min-h-32 flex flex-col justify-between hover:bg-muted/50 hover:border-primary/40 transition-colors"
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            Import
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Drop or browse a telemetry file to add it to your sessions.
          </p>
        </div>
        <span className="mt-4 text-xs text-primary">Add a datalog →</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a datalog</DialogTitle>
          </DialogHeader>
          <FileImport
            onDataLoaded={handleDataLoaded}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
