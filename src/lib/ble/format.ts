/**
 * Display formatters for BLE transfer progress UI.
 * Pure functions — no BLE dependencies.
 */

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

/** Format transfer speed (bytes/sec) to human-readable string. */
export function formatSpeed(bytesPerSecond: number): string {
  if (isNaN(bytesPerSecond) || !isFinite(bytesPerSecond)) {
    return "0 B/s";
  }
  if (bytesPerSecond < 1024) return bytesPerSecond.toFixed(0) + " B/s";
  if (bytesPerSecond < 1048576) return (bytesPerSecond / 1024).toFixed(1) + " KB/s";
  return (bytesPerSecond / 1048576).toFixed(2) + " MB/s";
}

/** Format time remaining (seconds) as e.g. "12s" or "1m 30s". */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return "--";
  }
  if (seconds < 60) return Math.ceil(seconds) + "s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}
