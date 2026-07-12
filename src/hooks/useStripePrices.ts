import { useCallback } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { StripeConfig } from "@/lib/billing";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

export interface StripePricesState {
  loading: boolean;
  config: StripeConfig;
}

const UNCONFIGURED: StripeConfig = { configured: false, prices: [] };

interface Snapshot {
  config: StripeConfig;
  loaded: boolean;
}

const EMPTY: Snapshot = { config: UNCONFIGURED, loaded: false };

/**
 * Reads the live Stripe pricing catalogue (monthly/annual prices per paid tier)
 * for the pricing UI. Online-only and cloud-gated; never throws into render —
 * any failure reads as "not configured", which collapses the UI to the free
 * cards. Public data, so it works signed-out.
 */
export function useStripePrices(): StripePricesState {
  const online = useOnlineStatus();

  const load = useCallback(async (): Promise<Snapshot> => {
    if (!enableCloud) return { config: UNCONFIGURED, loaded: true };
    try {
      // Dynamic import: billingClient pulls the Supabase client, which must
      // stay off the eager graph (keep the offline-first payload Supabase-free).
      const { fetchStripeConfig } = await import("@/lib/billingClient");
      const config = await fetchStripeConfig();
      return { config, loaded: true };
    } catch {
      return { config: UNCONFIGURED, loaded: true };
    }
  }, []);

  const key = `stripe-prices:${online ? "on" : "off"}`;

  const { data } = useAsyncSnapshot({ key, initial: EMPTY, load });

  return {
    loading: enableCloud && !data.loaded,
    config: data.config,
  };
}
