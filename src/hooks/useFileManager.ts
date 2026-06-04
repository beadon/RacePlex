import { useState, useCallback } from "react";
import {
  FileEntry,
  FileMetadata,
  saveFile as dbSave,
  listFiles,
  getFile,
  deleteFile as dbDelete,
  getStorageEstimate,
  getFileMetadata,
} from "@/lib/fileStorage";

/** Garage sub-tabs the drawer can be opened directly to. */
export type GarageTabKey = "files" | "vehicles" | "setups" | "notes";

export function useFileManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileMetadataMap, setFileMetadataMap] = useState<Map<string, FileMetadata>>(new Map());
  const [storageUsed, setStorageUsed] = useState(0);
  const [storageQuota, setStorageQuota] = useState(0);
  const [initialGarageTab, setInitialGarageTab] = useState<GarageTabKey>("files");

  const refresh = useCallback(async () => {
    const [fileList, estimate] = await Promise.all([listFiles(), getStorageEstimate()]);
    setFiles(fileList);
    if (estimate) {
      setStorageUsed(estimate.used);
      setStorageQuota(estimate.quota);
    }
    // Load metadata for all files
    const metaEntries = await Promise.all(
      fileList.map(async (f) => {
        const meta = await getFileMetadata(f.name);
        return [f.name, meta] as const;
      })
    );
    const map = new Map<string, FileMetadata>();
    for (const [name, meta] of metaEntries) {
      if (meta) map.set(name, meta);
    }
    setFileMetadataMap(map);
  }, []);

  // Accepts an optional garage sub-tab to open straight to. Guarded against
  // being wired directly as an event handler (e.g. onClick), where the first
  // argument would be a MouseEvent rather than a tab key.
  const open = useCallback((garageTab?: GarageTabKey) => {
    setInitialGarageTab(typeof garageTab === "string" ? garageTab : "files");
    setIsOpen(true);
    refresh();
  }, [refresh]);

  const close = useCallback(() => setIsOpen(false), []);

  const saveFile = useCallback(
    async (name: string, blob: Blob) => {
      await dbSave(name, blob);
      await refresh();
    },
    [refresh],
  );

  const removeFile = useCallback(
    async (name: string) => {
      await dbDelete(name);
      await refresh();
    },
    [refresh],
  );

  const exportFile = useCallback(async (name: string) => {
    const blob = await getFile(name);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const loadFile = useCallback(async (name: string): Promise<Blob | null> => {
    return getFile(name);
  }, []);

  return {
    isOpen,
    files,
    fileMetadataMap,
    storageUsed,
    storageQuota,
    initialGarageTab,
    open,
    close,
    refresh,
    saveFile,
    removeFile,
    exportFile,
    loadFile,
  };
}
