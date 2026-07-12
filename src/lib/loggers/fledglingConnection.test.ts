import { describe, it, expect, vi, beforeEach } from "vitest";
import * as ble from "@/lib/ble";
import { createFledglingConnection } from "./fledglingConnection";

vi.mock("@/lib/ble", () => ({
  requestFileList: vi.fn(),
  downloadFile: vi.fn(),
  disconnect: vi.fn(),
}));

function fakeBle(name?: string) {
  return { device: { name } } as unknown as ble.BleConnection;
}

describe("createFledglingConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a Fledgling that supports device details", () => {
    const conn = createFledglingConnection(fakeBle("DovesLapTimer 1"));
    expect(conn.kind).toBe("fledgling");
    expect(conn.supportsDeviceDetails).toBe(true);
    expect(conn.displayName).toBe("DovesLapTimer 1");
  });

  it("falls back to a brand name when the device is unnamed", () => {
    const conn = createFledglingConnection(fakeBle(undefined));
    expect(conn.displayName).toBe("PerchWerks Fledgling");
  });

  it("delegates listLogs to the BLE file-list request", async () => {
    const files = [{ name: "RUN1.dove", size: 10 }];
    vi.mocked(ble.requestFileList).mockResolvedValue(files);
    const underlying = fakeBle("x");
    const conn = createFledglingConnection(underlying);
    const onStatus = vi.fn();

    await expect(conn.listLogs(onStatus)).resolves.toBe(files);
    expect(ble.requestFileList).toHaveBeenCalledWith(underlying, onStatus);
  });

  it("delegates downloadLog to the BLE file download", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(ble.downloadFile).mockResolvedValue(bytes);
    const underlying = fakeBle("x");
    const conn = createFledglingConnection(underlying);
    const onProgress = vi.fn();
    const onStatus = vi.fn();

    await expect(conn.downloadLog("RUN1.dove", onProgress, onStatus)).resolves.toBe(bytes);
    expect(ble.downloadFile).toHaveBeenCalledWith(underlying, "RUN1.dove", onProgress, onStatus);
  });

  it("delegates disconnect to the BLE teardown", () => {
    const underlying = fakeBle("x");
    createFledglingConnection(underlying).disconnect();
    expect(ble.disconnect).toHaveBeenCalledWith(underlying);
  });
});
