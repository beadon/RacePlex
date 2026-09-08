import { useCallback, useRef, useState } from "react";
import { connectVescLive, type VescConnection } from "@/lib/live/vescTransport";
import type { VescSetupValues } from "@/lib/live/vescDecoder";
import type { ConcurrentSourceMerger } from "@/lib/live/concurrentCapture";

export type VescSidecarStatus = "idle" | "connecting" | "connected" | "error";

export interface VescSidecarController {
  status: VescSidecarStatus;
  deviceName: string | null;
  error: string | null;
  latest: VescSetupValues | null;
  sampleCount: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Optional second BLE connection alongside a primary live capture (issue
 * #58: "the phone should be able to connect and pair with 2x devices").
 * Feeds every VESC sample into `merger` — owned by the caller, which also
 * feeds its own primary samples in — so the two streams merge by receipt
 * time (`concurrentCapture.ts`). This hook only owns the VESC connection's
 * lifecycle and UI-facing status; it never touches the primary source.
 */
export function useVescSidecar(
  merger: ConcurrentSourceMerger<unknown, VescSetupValues>,
): VescSidecarController {
  const [status, setStatus] = useState<VescSidecarStatus>("idle");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<VescSetupValues | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const connectionRef = useRef<VescConnection | null>(null);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const conn = await connectVescLive();
      connectionRef.current = conn;
      setDeviceName(conn.name);
      conn.subscribeToSamples((sample, receivedAt) => {
        merger.addSecondary({ receivedAt, data: sample });
        setLatest(sample);
        setSampleCount((n) => n + 1);
      });
      setStatus("connected");
    } catch (e) {
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
