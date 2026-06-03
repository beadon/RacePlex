import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { listAllMetadata } from '@/lib/fileStorage';
import { filesTaggedWithCourse, type CourseFileEntry } from '@/lib/fileBrowserTree';
import { formatLapTime } from '@/lib/lapCalculation';
import { externalOverlayId, type OverlayLine } from '@/lib/lapOverlays';
import { Layers, Loader2, Trophy, Check, Target, X, ChevronDown, ChevronRight } from 'lucide-react';

interface OverlaysMenuProps {
  hasCourse: boolean;
  trackName?: string | null;
  courseName?: string | null;
  /** Current session — excluded from the "add from other logs" list. */
  currentFileName?: string | null;
  overlayLines: OverlayLine[];
  onLoadOverlayFile: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onAddExternalOverlay: (fileName: string, lapNumber: number, displayName?: string) => void;
  onToggleOverlay: (id: string) => void;
  /** Promote one of the current overlays to the comparison reference lap. */
  onSetOverlayReference: (line: OverlayLine) => void;
}

/**
 * The "Overlays" menu — one place to manage the racing-line overlays drawn on
 * the map + graphs. Two collapsible sections:
 *   1. Current overlays — every active overlay line, each promotable to the
 *      comparison reference lap or removable.
 *   2. Add from this course's logs — the other saved sessions tagged with the
 *      current course (labeled by date/time, never raw file names); pick one to
 *      load its laps and toggle them on as overlays.
 *
 * Snapshots are still added through the separate Snapshots menu — this only sets
 * references from, and grows, the overlay set.
 */
export function OverlaysMenu({
  hasCourse, trackName, courseName, currentFileName, overlayLines,
  onLoadOverlayFile, onAddExternalOverlay, onToggleOverlay, onSetOverlayReference,
}: OverlaysMenuProps) {
  const [open, setOpen] = useState(false);
  const [showCurrent, setShowCurrent] = useState(true);
  const [showAdd, setShowAdd] = useState(true);
  const [courseFiles, setCourseFiles] = useState<CourseFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<CourseFileEntry | null>(null);
  const [loadingLaps, setLoadingLaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [laps, setLaps] = useState<Array<{ lapNumber: number; lapTimeMs: number }>>([]);

  if (!hasCourse) return null;

  const openDialog = async () => {
    setSelectedFile(null);
    setLaps([]);
    setError(null);
    setOpen(true);
    setLoadingFiles(true);
    try {
      const meta = await listAllMetadata();
      setCourseFiles(
        filesTaggedWithCourse(meta, trackName ?? undefined, courseName ?? undefined, currentFileName ?? undefined),
      );
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleFileClick = async (file: CourseFileEntry) => {
    setLoadingLaps(true);
    setError(null);
    setSelectedFile(file);
    try {
      const result = await onLoadOverlayFile(file.fileName);
      if (!result || result.length === 0) {
        setError('No laps detected for the current course.');
        return;
      }
      setLaps(result);
    } catch {
      setError('Failed to load or parse the file.');
    } finally {
      setLoadingLaps(false);
    }
  };

  const backToFiles = () => {
    setSelectedFile(null);
    setLaps([]);
    setError(null);
  };

  const fastestIdx = laps.reduce((minIdx, lap, idx, arr) => (lap.lapTimeMs < arr[minIdx].lapTimeMs ? idx : minIdx), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm" onClick={openDialog}>
          <Layers className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Overlays</span>
          {overlayLines.length > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {overlayLines.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[75vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Overlays</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 -mx-2 px-2 divide-y divide-border">
          {/* ── Section 1: current overlays ────────────────────────────── */}
          <Collapsible open={showCurrent} onOpenChange={setShowCurrent}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-sm font-medium">
              {showCurrent ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Current overlays
              <span className="ml-auto rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {overlayLines.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {overlayLines.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  No overlays yet. Add laps from the lap list, the Snapshots menu, or another log below.
                </p>
              ) : (
                <ul className="space-y-0.5 pb-2">
                  {overlayLines.map((line) => (
                    <li key={line.id} className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-muted/50">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: line.color }} />
                      <span className="flex-1 truncate">{line.label}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs gap-1"
                        title="Use as reference lap"
                        onClick={() => onSetOverlayReference(line)}
                      >
                        <Target className="h-3 w-3" />
                        Ref
                      </Button>
                      <button
                        className="rounded p-1 transition-colors hover:bg-muted"
                        title="Remove overlay"
                        onClick={() => onToggleOverlay(line.id)}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* ── Section 2: add from other logs on this course ──────────── */}
          <Collapsible open={showAdd} onOpenChange={setShowAdd}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-sm font-medium">
              {showAdd ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {selectedFile ? `Laps — ${selectedFile.displayName}` : 'Add from other logs'}
            </CollapsibleTrigger>
            <CollapsibleContent>
              {loadingFiles || loadingLaps ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="py-4 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={backToFiles}>
                    Back to logs
                  </Button>
                </div>
              ) : !selectedFile ? (
                courseFiles.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    No other saved logs are tagged with this course.
                  </p>
                ) : (
                  <ul className="space-y-0.5 pb-2">
                    {courseFiles.map((file) => (
                      <li key={file.fileName}>
                        <button
                          className="w-full truncate rounded px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                          onClick={() => handleFileClick(file)}
                        >
                          {file.displayName}
                          {file.fastestLapMs !== undefined && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              best {formatLapTime(file.fastestLapMs)}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="pb-2">
                  <ul className="space-y-0.5">
                    {laps.map((lap, idx) => {
                      const id = externalOverlayId(selectedFile.fileName, lap.lapNumber);
                      const overlay = overlayLines.find((l) => l.id === id);
                      const isFastest = idx === fastestIdx;
                      return (
                        <li key={lap.lapNumber}>
                          <button
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-mono transition-colors hover:bg-muted/50"
                            onClick={() =>
                              overlay
                                ? onToggleOverlay(id)
                                : onAddExternalOverlay(selectedFile.fileName, lap.lapNumber, selectedFile.displayName)
                            }
                          >
                            {overlay ? (
                              <Check className="h-3.5 w-3.5 shrink-0" style={{ color: overlay.color }} />
                            ) : isFastest ? (
                              <Trophy className="h-3.5 w-3.5 shrink-0 text-racing-lapBest" />
                            ) : (
                              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className={isFastest && !overlay ? 'text-racing-lapBest' : ''}>
                              Lap {lap.lapNumber} : {formatLapTime(lap.lapTimeMs)}
                            </span>
                            {overlay && <span className="ml-auto text-[11px] text-muted-foreground">on map</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="px-3 pt-2">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={backToFiles}>
                      ← Back to logs
                    </Button>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogContent>
    </Dialog>
  );
}
