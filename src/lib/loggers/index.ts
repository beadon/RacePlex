/**
 * Generic logger layer. The app downloads from any logger through
 * `LoggerConnection`; transport-specific adapters live alongside (BLE today).
 */

export type { LoggerKind, LoggerFile, LoggerDownloadProgress, LoggerConnection } from "./types";
export { createFledglingConnection } from "./fledglingConnection";
