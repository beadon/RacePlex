import { useEffect, useRef, useState } from "react";
import { Download, HardDrive, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { downloadMyData, estimateVideoBytes, type ExportProgress } from "@/lib/dataExport";
import { importArchive, type ImportSummary } from "@/lib/dataImport";

/**
 * "Download my data" — the rider's way to get their sessions out of the browser,
 * and back into a new one.
 *
 * RacePlex has no account and no server, so everything lives in this browser and
 * dies with it: clear the site data, switch laptops, and it is gone. This is the
 * exit. It works offline, signed out, on a build with no backend — which is
 * every stock build.
 *
 * Mounted in three places (Settings, the Tools tab, the Files drawer), so the
 * rider finds it wherever they go looking for their data.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export interface DataExportSectionProps {
  /**
   * Drop the heading and the explanatory blurb, leaving just the controls. For
   * hosts that already frame the section themselves — the Files drawer, which
   * sits under its own storage-usage bar.
   */
  compact?: boolean;
}

export function DataExportSection({ compact = false }: DataExportSectionProps = {}) {
  const [exporting, setExporting] = useState(false);
  const [phase, setPhase] = useState("");
  const [includeVideos, setIncludeVideos] = useState(false);
  const [videos, setVideos] = useState<{ count: number; bytes: number } | null>(null);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Measure the stored video blobs so the checkbox can say what it will cost.
  // A rider with a season of footage has gigabytes here, and a button that
  // silently produces a 4 GB zip reads as a hang.
  useEffect(() => {
    let cancelled = false;
    void estimateVideoBytes().then((v) => {
      if (!cancelled) setVideos(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runExport = async () => {
    setExporting(true);
    setPhase("Gathering your data…");
    try {
      await downloadMyData({
        includeVideos,
        onProgress: (p: ExportProgress) => setPhase(p.phase),
      });
      toast.success("Your data has been downloaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
      setPhase("");
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      setResult(await importArchive(file));
    } catch {
      toast.error("That doesn't look like a RacePlex export.");
    } finally {
      setImporting(false);
    }
  };

  const hasVideos = (videos?.count ?? 0) > 0;

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      {!compact && (
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium">Your data</h3>
        </div>
      )}

      <div className={compact ? "space-y-2" : "space-y-3 pl-6"}>
        {!compact && (
          <p className="text-xs text-muted-foreground">
            Everything RacePlex holds — your sessions, vehicles, setups, notes, custom tracks and lap
            snapshots — is stored in this browser and nowhere else. Download it as a .zip to back it
            up, move it to another device, or open the logs in another tool.
          </p>
        )}

        {hasVideos && !compact && (
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              <div>Include session videos</div>
              <div>
                {videos!.count} video{videos!.count === 1 ? "" : "s"}, {formatBytes(videos!.bytes)} — the
                download will take considerably longer.
              </div>
            </div>
            <Switch
              checked={includeVideos}
              onCheckedChange={setIncludeVideos}
              disabled={exporting}
              aria-label="Include session videos in the export"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void runExport()} disabled={exporting} variant="outline" size="sm">
            {exporting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {exporting ? phase || "Preparing…" : "Download my data"}
          </Button>

          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => void onFile(e)}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={importing}
            onClick={() => inputRef.current?.click()}
          >
            {importing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            {importing ? "Restoring…" : "Import data"}
          </Button>
        </div>

        {result && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Restored {result.files} session{result.files === 1 ? "" : "s"}
              {result.videos > 0 && `, ${result.videos} video${result.videos === 1 ? "" : "s"}`}
              {result.records > 0 && ` and ${result.records} garage record${result.records === 1 ? "" : "s"}`}
              {result.filesSkipped > 0 &&
                ` — ${result.filesSkipped} session${result.filesSkipped === 1 ? " was" : "s were"} already here and left untouched`}
              .
            </span>
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
              Reload to see them
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
