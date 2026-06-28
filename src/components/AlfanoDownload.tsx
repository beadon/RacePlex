import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeviceListPanel, FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
import { createAlfanoConnection } from "@/lib/loggers/alfano/alfanoConnection";
import { loggerScan, loggerConnect, type ScannedDevice } from "@/lib/loggers/alfano/ipc";
import type { LoggerConnection, LoggerFile, LoggerDownloadProgress } from "@/lib/loggers";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";

type DownloadState =
  | "idle"
  | "scanning"
  | "device-list"
  | "connecting"
  | "fetching-files"
  | "file-list"
  | "downloading"
  | "error";

interface AlfanoDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /** Begin scanning as soon as the flow mounts (it's mounted on demand). */
  autoStart?: boolean;
  /** Called when the flow finishes or is dismissed so the host can unmount it. */
  onClose: () => void;
}

/**
 * The native (Tauri) Alfano download flow — SKELETON. Alfano talks over Bluetooth
 * serial (Classic Bluetooth SPP), which the web can't reach, so this flow is
 * native-only and is mounted on demand by `LoggerDownload` once the user picks
 * Alfano on the native app, keeping `@tauri-apps/api` off the web/eager bundle.
 * Mirrors `DovesloggerDownload`: scan → pick device → connect → list → download +
 * import. Talks to the device only through the generic `LoggerConnection`
 * surface, and owns the connection — it disconnects on every exit
 * (close/cancel/error/unmount). The Rust backend it drives is still TBD.
 */
export function AlfanoDownload({ onDataLoaded, autoSave, autoSaveFile, autoStart, onClose }: AlfanoDownloadProps) {
  const { t } = useTranslation("logger");
  const [state, setState] = useState<DownloadState>("idle");
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [files, setFiles] = useState<LoggerFile[]>([]);
  const [progress, setProgress] = useState<LoggerDownloadProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [error, setError] = useState<string>("");
  const loggerRef = useRef<LoggerConnection | null>(null);

  const handleClose = useCallback(() => {
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setState("idle");
    setDevices([]);
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setError("");
    onClose();
  }, [onClose]);

  const handleScan = useCallback(async () => {
    setError("");
    // A fresh scan implies any prior connection is stale — drop it.
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setState("scanning");
    try {
      const found = await loggerScan();
      setDevices(found);
      setState("device-list");
    } catch (err) {
      console.error("Alfano scan error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  const handleDeviceSelect = useCallback(async (device: ScannedDevice) => {
    setError("");
    setState("connecting");
    try {
      const info = await loggerConnect({ host: device.id });
      const logger = createAlfanoConnection(info);
      loggerRef.current = logger;

      setState("fetching-files");
      const fileList = await logger.listLogs();
      setFiles(fileList);
      setState("file-list");
    } catch (err) {
      console.error("Alfano connect/list error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  // Kick off the scan as soon as the flow is mounted (once).
  const startedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void handleScan();
    }
  }, [autoStart, handleScan]);

  // Always release the device when this flow unmounts.
  useEffect(() => () => void loggerRef.current?.disconnect(), []);

  const handleFileSelect = useCallback(
    async (file: LoggerFile) => {
      const logger = loggerRef.current;
      if (!logger) {
        setError(t("alfano.flow.errorTitle"));
        setState("error");
        return;
      }

      setState("downloading");
      setCurrentFile(file.name);
      setProgress({ received: 0, total: file.size, percent: 0, speed: "0 B/s", eta: "--" });
      setError("");

      try {
        const bytes = await logger.downloadLog(file.name, setProgress);
        const blob = new Blob([bytes.buffer as ArrayBuffer]);

        // Save the raw file first so it's never lost.
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(file.name, blob);
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }

        const data = await parseDatalogFile(new File([blob], file.name));
        handleClose();
        onDataLoaded(data, file.name);
      } catch (err) {
        console.error("Alfano download/parse error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`${msg}${t("alfano.flow.savedHint")}`);
        setState("error");
      }
    },
    [autoSave, autoSaveFile, handleClose, onDataLoaded, t],
  );

  const isModalOpen = state !== "idle";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="w-5 h-5" />
            {state === "scanning" && t("alfano.flow.scanning")}
            {state === "device-list" && t("alfano.flow.selectDevice")}
            {state === "connecting" && t("alfano.flow.connecting")}
            {state === "fetching-files" && t("alfano.flow.fetching")}
            {state === "file-list" && t("alfano.flow.selectFile")}
            {state === "downloading" && t("alfano.flow.downloading")}
            {state === "error" && t("alfano.flow.errorTitle")}
          </DialogTitle>
        </DialogHeader>

        {state === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("alfano.flow.scanning")}</p>
          </div>
        )}

        {state === "device-list" && (
          <DeviceListPanel
            devices={devices}
            onSelect={handleDeviceSelect}
            onRescan={handleScan}
            instructions={t("alfano.flow.deviceInstructions")}
            emptyText={t("alfano.flow.noDevices")}
            rescanLabel={t("alfano.flow.rescan")}
          />
        )}

        {state === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("alfano.flow.connecting")}</p>
          </div>
        )}

        {state === "fetching-files" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("alfano.flow.fetching")}</p>
          </div>
        )}

        {state === "file-list" && (
          <FileListPanel
            files={files}
            onSelect={handleFileSelect}
            instructions={t("alfano.flow.instructions")}
            emptyText={t("alfano.flow.empty")}
          />
        )}

        {state === "downloading" && progress && (
          <ProgressPanel currentFile={currentFile} progress={progress} />
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-destructive text-center">{error}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                {t("alfano.flow.cancel")}
              </Button>
              <Button onClick={handleScan}>{t("alfano.flow.retry")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
