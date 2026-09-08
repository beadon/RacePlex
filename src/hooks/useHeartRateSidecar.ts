import { useCallback, useRef, useState } from "react";
import { connectHeartRateLive, type HeartRateConnection } from "@/lib/live/heartRateTransport";
import type { HeartRateSample } from "@/lib/live/heartRateDecoder";
import type { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";
import { isUserCancelledBluetoothPicker } from "@/lib/live/bleUtils";

export type HeartRateSidecarStatus = "idle" | "connecting" | "connected" | "error";

export interface HeartRateSidecarController {
  status: HeartRateSidecarStatus;
  deviceName: string | null;
  error: string | null;
  latest: HeartRateSample | null;
  sampleCount: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * A fourth optional BLE connection alongside a primary live capture and the
 * VESC/BMS sidecars (issue #87, mirrors `useVescSidecar.ts`/`useBmsSidecar.ts`
 * exactly). Feeds every heart-rate sample into `merger` — owned by the
 * caller, which also feeds its own primary samples in — so the streams merge
 * by receipt time (`concurrentCapture.ts`). This hook only owns the
 * heart-rate connection's lifecycle and UI-facing status; it never touches
 * the primary source, and never touches the Garage/Vehicle binding VESC/BMS
 * use (`useSidecarVehicleBinding.ts`) — a heart-rate monitor belongs to the
 * rider, not the board.
 */
export function useHeartRateSidecar(
  merger: ConcurrentSourceMerger<unknown, HeartRateSample>,
): HeartRateSidecarController {
  const [status, setStatus] = useState<HeartRateSidecarStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<HeartRateSample | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const connectionRef = useRef<HeartRateConnection | null>(null);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const conn = await connectHeartRateLive();
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
