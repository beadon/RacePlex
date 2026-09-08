import { useCallback, useRef, useState } from "react";
import { connectBmsLive, type BmsConnection, type BmsSample } from "@/lib/live/bmsTransport";
import type { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";
import { isUserCancelledBluetoothPicker } from "@/lib/live/bleUtils";

export type BmsSidecarStatus = "idle" | "connecting" | "connected" | "error";

export interface BmsSidecarController {
  status: BmsSidecarStatus;
  deviceName: string | null;
  error: string | null;
  latest: BmsSample | null;
  sampleCount: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Optional third BLE connection alongside a primary live capture and the
 * optional VESC sidecar (issue #73, mirrors `useVescSidecar.ts` exactly).
 * Feeds every BMS sample into `merger` — owned by the caller, which also
 * feeds its own primary samples in — so the streams merge by receipt time
 * (`concurrentCapture.ts`). This hook only owns the BMS connection's
 * lifecycle and UI-facing status; it never touches the primary source.
 */
export function useBmsSidecar(
  merger: ConcurrentSourceMerger<unknown, BmsSample>,
): BmsSidecarController {
  const [status, setStatus] = useState<BmsSidecarStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<BmsSample | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const connectionRef = useRef<BmsConnection | null>(null);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const conn = await connectBmsLive();
      connectionRef.current = conn;
      setDeviceName(conn.name);
      conn.subscribeToSamples((sample, receivedAt) => {
        merger.addSecondary({ receivedAt, data: sample });
        setLatest(sample);
        setSampleCount((n) => n + 1);
      });
      setStatus("connected");
    } catch (e) {
      // Dismissing the browser's own device picker isn't a failure — just
      // let the rider try again from a clean idle state instead of showing
      // an error with troubleshooting text that doesn't apply here.
      if (isUserCancelledBluetoothPicker(e)) {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [merger]);

  const disconnect = useCallback(async () => {
    await connectionRef.current?.disconnect();
    connectionRef.current = null;
    merger.reset();
    setStatus("idle");
    setDeviceName(null);
    setLatest(null);
  }, [merger]);

  return { status, deviceName, error, latest, sampleCount, connect, disconnect };
}
