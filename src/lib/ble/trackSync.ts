/// <reference types="web-bluetooth" />

import type { BleConnection, DownloadProgress } from "./types";
import { bleLog } from "./internal";
import { formatSpeed, formatTime } from "./format";

/**
 * Track-File Protocol.
 *
 * Commands on `fileRequest`:
 *   TLIST            -> TFILE:name lines on `fileStatus`, terminated by TEND
 *   TGET:<name>      -> SIZE/chunks/DONE flow on `fileData` + `fileStatus`
 *   TPUT:<name>      -> TREADY on `fileStatus`, then app sends chunks + TDONE,
 *                       device responds TOK or TERR:reason
 *   TDEL:<name>      -> TOK or TERR:reason on `fileStatus`
 */

/** Request list of track files on device via TLIST. Returns filenames (e.g. ["OKC.json"]). */
export async function requestTrackFileList(connection: BleConnection): Promise<string[]> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    const files: string[] = [];
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("TLIST raw:", JSON.stringify(raw));

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line === "TEND") {
          cleanup();
          resolve(files);
          return;
        }
        if (line.startsWith("TFILE:")) {
          files.push(line.substring(6));
        }
      }

      // Reset safety timeout
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        resolve(files);
      }, 3000);
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("TLIST"));

      setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for track file list"));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Download a track file from device via TGET.
 * Optimized for high-throughput burst transfers — same pattern as downloadFile.
 */
export async function downloadTrackFile(
  connection: BleConnection,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Uint8Array> {
  const updateProgress = onProgress || (() => {});

  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    const receivedData: Uint8Array[] = [];
    let totalReceived = 0;
    let expectedFileSize = 0;
    let transferStartTime = Date.now();
    let progressRafId = 0;
    let progressDirty = false;
    let resolved = false;

    const scheduleProgressUpdate = () => {
      if (progressDirty || progressRafId) return;
      progressDirty = true;
      progressRafId = requestAnimationFrame(() => {
        progressRafId = 0;
        progressDirty = false;
        if (resolved) return;

        const percent = expectedFileSize > 0 ? (totalReceived / expectedFileSize) * 100 : 0;
        const elapsedSeconds = (Date.now() - transferStartTime) / 1000;
        const overallSpeed = elapsedSeconds > 0 ? totalReceived / elapsedSeconds : 0;
        const remainingBytes = expectedFileSize - totalReceived;
        const etaSeconds = overallSpeed > 0 ? remainingBytes / overallSpeed : 0;

        updateProgress({
          received: totalReceived,
          total: expectedFileSize,
          percent,
          speed: formatSpeed(overallSpeed),
          eta: formatTime(etaSeconds),
        });
      });
    };

    const handleFileData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const dv = target.value!;
      const chunk = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
      receivedData.push(chunk);
      totalReceived += chunk.length;
      scheduleProgressUpdate();
    };

    const statusDecoder = new TextDecoder();

    const handleStatusData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = statusDecoder.decode(target.value!);
      bleLog("TGET status:", raw);

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("SIZE:")) {
          expectedFileSize = parseInt(line.substring(5), 10);
          transferStartTime = Date.now();
        } else if (line === "DONE") {
          resolved = true;
          if (progressRafId) {
            cancelAnimationFrame(progressRafId);
            progressRafId = 0;
          }
          cleanup();
          const fileData = new Uint8Array(totalReceived);
          let offset = 0;
          for (let i = 0; i < receivedData.length; i++) {
            fileData.set(receivedData[i], offset);
            offset += receivedData[i].length;
          }
          resolve(fileData);
          return;
        } else if (line.startsWith("TERR:") || line === "ERROR") {
          resolved = true;
          if (progressRafId) {
            cancelAnimationFrame(progressRafId);
            progressRafId = 0;
          }
          cleanup();
          reject(
            new Error(
              line.startsWith("TERR:") ? line.substring(5) : "Error downloading track file",
            ),
          );
          return;
        }
      }
    };

    const cleanup = () => {
      connection.characteristics.fileData.removeEventListener(
        "characteristicvaluechanged",
        handleFileData,
      );
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleStatusData,
      );
    };

    try {
      await connection.characteristics.fileData.startNotifications();
      connection.characteristics.fileData.addEventListener(
        "characteristicvaluechanged",
        handleFileData,
      );

      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleStatusData,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("TGET:" + filename));

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (progressRafId) {
            cancelAnimationFrame(progressRafId);
            progressRafId = 0;
          }
          cleanup();
          reject(new Error("Track file download timeout"));
        }
      }, 60000);
    } catch (error) {
      resolved = true;
      if (progressRafId) {
        cancelAnimationFrame(progressRafId);
        progressRafId = 0;
      }
      cleanup();
      reject(error);
    }
  });
}

/**
 * Upload a track file to device via TPUT.
 * Flow: TPUT:name → wait TREADY → send chunks → TDONE → wait TOK
 */
export async function uploadTrackFile(
  connection: BleConnection,
  filename: string,
  data: Uint8Array,
): Promise<void> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let phase: "waiting_ready" | "uploading" | "waiting_ok" = "waiting_ready";

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("TPUT status:", raw, "phase:", phase);

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line === "TREADY" && phase === "waiting_ready") {
          phase = "uploading";
          // Send data chunks
          sendChunks().catch((err) => {
            cleanup();
            reject(err);
          });
          return;
        } else if (line === "TOK" && phase === "waiting_ok") {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith("TERR:")) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const sendChunks = async () => {
      const CHUNK_SIZE = 64;
      const encoder = new TextEncoder();

      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, Math.min(i + CHUNK_SIZE, data.length));
        await connection.characteristics.fileRequest.writeValue(chunk);
        // Small delay between chunks for device stability
        await new Promise((r) => setTimeout(r, 10));
      }

      // Signal end of upload
      await connection.characteristics.fileRequest.writeValue(encoder.encode("TDONE"));
      phase = "waiting_ok";

      // Reset timeout for TOK response
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for upload confirmation"));
      }, 10000);
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("TPUT:" + filename));

      // Timeout waiting for TREADY
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for device ready"));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Delete a track file from device via TDEL.
 * Flow: TDEL:name.json → wait TOK or TERR
 */
export async function deleteTrackFile(
  connection: BleConnection,
  filename: string,
): Promise<void> {
  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog("TDEL status:", raw);

      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line === "TOK") {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith("TERR:")) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleNotification,
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("TDEL:" + filename));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for delete confirmation"));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
