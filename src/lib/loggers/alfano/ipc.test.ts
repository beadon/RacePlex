import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock of the Tauri core API (dynamically imported by ../native/ipc).
const { invoke, ChannelMock } = vi.hoisted(() => {
  const invoke = vi.fn();
  class ChannelMock<T> {
    onmessage: ((m: T) => void) | null = null;
  }
  return { invoke, ChannelMock };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: ChannelMock }));

import { loggerScan, loggerConnect } from "./ipc";

// The kind-agnostic commands (list / download / disconnect) are covered by
// ../native/ipc.test.ts; this suite asserts the Alfano-specific scan/connect.
describe("alfano ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans with the alfano kind and returns the device list", async () => {
    const devices = [{ id: "AA:BB", name: "Alfano 6", rssi: -52 }];
    invoke.mockResolvedValue(devices);
    await expect(loggerScan()).resolves.toEqual(devices);
    expect(invoke).toHaveBeenCalledWith("logger_scan", { kind: "alfano" });
  });

  it("connects to the chosen device by id (host)", async () => {
    invoke.mockResolvedValue({ kind: "alfano", fields: {} });
    await loggerConnect({ host: "AA:BB" });
    expect(invoke).toHaveBeenCalledWith("logger_connect", {
      kind: "alfano",
      host: "AA:BB",
    });
  });

  it("connects to the first logger found when no host is given", async () => {
    invoke.mockResolvedValue({ kind: "alfano", fields: {} });
    await loggerConnect();
    expect(invoke).toHaveBeenCalledWith("logger_connect", {
      kind: "alfano",
      host: undefined,
    });
  });

  it("passes backend error strings through unwrapped (prefix preserved)", async () => {
    invoke.mockRejectedValueOnce("unsupported: alfano backend not implemented");
    await expect(loggerScan()).rejects.toBe("unsupported: alfano backend not implemented");
  });
});
