import { useCallback, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Upload, Loader2 } from "lucide-react";
import { parseDatalogFile } from "@/lib/datalogParser";
import { groupGoProChapters, parseGoProChapterName } from "@/lib/gopro/gpmfChapters";
import { ParsedData } from "@/types/racing";

interface FileImportProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
}

/**
 * The drag-and-drop / click-to-browse "add data" action. The whole card is
 * the upload target. Rendered as a full-width dropzone at the top of the
 * Dashboard; other entry points (recent sessions, device download, track
 * manager) live in the tile grid below.
 */
export function FileImport({ onDataLoaded, autoSave, autoSaveFile }: FileImportProps) {
  const { t } = useTranslation("landing");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      setProgress(null);
      setFileName(file.name);

      try {
        // Always save the raw file first so it's never lost
        if (autoSave && autoSaveFile) {
          try { await autoSaveFile(file.name, file); } catch (e) { console.warn("Auto-save failed:", e); }
        }
        // The progress callback only fires for the two slow paths — AiM XRK/XRZ
        // (wasm parse in a worker) and GoPro .mp4 (GPMF extraction reads the whole
        // video). Other formats parse instantly.
        const data = await parseDatalogFile(file, (p) => setProgress(p.message));
        onDataLoaded(data, file.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("fileImport.parseFailed");
        setError(autoSave ? t("fileImport.parseErrorSaved", { message: msg }) : msg);
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [onDataLoaded, autoSave, autoSaveFile, t],
  );

  /**
   * A GoPro long recording is split into chapter files (`GX010042.MP4`,
   * `GX020042.MP4`, …). Import them together as one continuous session — see
   * issue #29. When the drop is a mix or a non-GoPro pick, fall back to
   * processing the first file only (current single-file behaviour).
   */
  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (files.length === 1) return processFile(files[0]);

      const allGoPro = files.every((f) => parseGoProChapterName(f.name) !== null);
      if (!allGoPro) {
        // Mixed pick — take the first file only, keeps behaviour predictable.
        return processFile(files[0]);
      }
      const groups = groupGoProChapters(files);
      if (groups.length !== 1) {
        // Multiple GoPro recordings selected at once — take the largest group.
        // A future release could import each as its own session.
        groups.sort((a, b) => b.length - a.length);
      }
      const chapters = groups[0];
      const displayName = chapters[0].name;

      setIsLoading(true);
      setError(null);
      setProgress(null);
      setFileName(displayName);
      try {
        if (autoSave && autoSaveFile) {
          // Auto-save every chapter under its own name so a rider can re-open
          // any single chapter later (the folded session is derived, not stored).
          for (const c of chapters) {
            try { await autoSaveFile(c.name, c); } catch (e) { console.warn("Auto-save failed:", e); }
          }
        }
        const { parseGoProSequence } = await import("@/lib/gopro/gpmfImporter");
        const data = await parseGoProSequence(chapters, (p) => setProgress(p.message));
        onDataLoaded(data, displayName);
      } catch (e) {
        const msg = e instanceof Error ? e.message : t("fileImport.parseFailed");
        setError(autoSave ? t("fileImport.parseErrorSaved", { message: msg }) : msg);
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [processFile, onDataLoaded, autoSave, autoSaveFile, t],
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;
      await processFiles(files);
    },
    [processFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          "flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          isDragging ? "border-primary bg-primary/10" : "border-border bg-card/50 hover:border-primary/50 hover:bg-card",
        ].join(" ")}
      >
        <input
          type="file"
          accept=".csv,.gpx,.nmea,.txt,.ubx,.vbo,.dove,.dovex,.ld,.xrk,.xrz,.ibt,.mp4"
          multiple
          onChange={handleFileChange}
          className="hidden"
          disabled={isLoading}
        />
        {isLoading ? (
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="h-7 w-7" />
          </span>
        )}
        <span className="text-xl font-semibold text-foreground">
          {isLoading ? (progress ?? t("fileImport.processing")) : t("fileImport.title")}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("fileImport.dragDrop")}
        </span>
        <span className="max-w-md text-xs text-muted-foreground">
          <Trans t={t} i18nKey="fileImport.formats" components={{ i: <i /> }} />
        </span>
      </label>

      {fileName && !error && (
        <p className="text-center text-sm font-mono text-muted-foreground">{t("fileImport.loaded", { name: fileName })}</p>
      )}
      {error && <p className="text-center text-sm font-medium text-destructive">{t("fileImport.errorLine", { error })}</p>}
    </div>
  );
}
