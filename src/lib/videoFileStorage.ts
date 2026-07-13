/**
 * IndexedDB storage for video file blobs attached to telemetry sessions.
 * One video per session file. Stored in the "session-videos" object store.
 *
 * User-scoped (plan 0011): saveSessionVideo stamps the active user's id;
 * listSessionVideos filters to it. By-name lookups (load/get/has/delete) are
 * intentionally not scoped.
 */

import { openDB, STORE_NAMES } from "./dbUtils";
import { activeUserIdOrDefault } from "./localUserStorage";

export interface StoredVideo {
  sessionFileName: string;
  videoBlob: Blob;
  videoFileName: string;
  savedAt: number;
  size: number;
  /** What was exported: full session, single lap, or raw source video */
  exportType: "session" | "lap" | "raw";
  /** Which lap number if exportType === "lap" */
  lapNumber?: number;
  /** Whether overlays were baked into the video */
  hasOverlays: boolean;
  /**
   * Owning local user (plan 0011). Stamped by saveSessionVideo when missing;
   * listSessionVideos filters on the active user's id.
   */
  userId?: string;
}

export interface StoredVideoMeta {
  sessionFileName: string;
  videoFileName: string;
  savedAt: number;
  size: number;
  exportType: "session" | "lap" | "raw";
  lapNumber?: number;
  hasOverlays: boolean;
}

export async function saveSessionVideo(
  sessionFileName: string,
  blob: Blob,
  videoFileName: string,
  exportType: "session" | "lap" | "raw" = "raw",
  hasOverlays: boolean = false,
  lapNumber?: number,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readwrite");
  tx.objectStore(STORE_NAMES.SESSION_VIDEOS).put({
    sessionFileName,
    videoBlob: blob,
    videoFileName,
    savedAt: Date.now(),
    size: blob.size,
    exportType,
    lapNumber,
    hasOverlays,
    userId: activeUserIdOrDefault(),
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSessionVideo(
  sessionFileName: string,
): Promise<{ blob: Blob; videoFileName: string; meta: StoredVideoMeta } | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).get(sessionFileName);
  const result = await new Promise<StoredVideo | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!result) return null;
  return {
    blob: result.videoBlob,
    videoFileName: result.videoFileName,
    meta: {
      sessionFileName: result.sessionFileName,
      videoFileName: result.videoFileName,
      savedAt: result.savedAt,
      size: result.size,
      exportType: result.exportType ?? "raw",
      lapNumber: result.lapNumber,
      hasOverlays: result.hasOverlays ?? false,
    },
  };
}

export async function deleteSessionVideo(sessionFileName: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readwrite");
  tx.objectStore(STORE_NAMES.SESSION_VIDEOS).delete(sessionFileName);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function hasSessionVideo(sessionFileName: string): Promise<boolean> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).count(
    IDBKeyRange.only(sessionFileName),
  );
  const count = await new Promise<number>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return count > 0;
}

/** Get metadata for a specific session's video (no blob) */
export async function getSessionVideoMeta(sessionFileName: string): Promise<StoredVideoMeta | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).get(sessionFileName);
  const result = await new Promise<StoredVideo | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!result) return null;
  return {
    sessionFileName: result.sessionFileName,
    videoFileName: result.videoFileName,
    savedAt: result.savedAt,
    size: result.size,
    exportType: result.exportType ?? "raw",
    lapNumber: result.lapNumber,
    hasOverlays: result.hasOverlays ?? false,
  };
}

/** List all stored videos for the active user (plan 0011), metadata only. */
export async function listSessionVideos(): Promise<StoredVideoMeta[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).getAll();
  const results = await new Promise<StoredVideo[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const uid = activeUserIdOrDefault();
  return results
    .filter((v) => v.userId === uid)
    .map(({ sessionFileName, videoFileName, savedAt, size, exportType, lapNumber, hasOverlays }) => ({
      sessionFileName,
      videoFileName,
      savedAt,
      size,
      exportType: exportType ?? "raw",
      lapNumber,
      hasOverlays: hasOverlays ?? false,
    }));
}
