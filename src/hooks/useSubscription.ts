import { useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { effectiveTier, type SubscriptionTierRow, type UserSubscriptionRow } from "@/lib/billing";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

export interface SubscriptionState {
  loading: boolean;
  error: string | null;
  /** All plans (sorted), for prices/labels/limits. Empty when signed out. */
  tiers: SubscriptionTierRow[];
  /** The user's raw subscription row (may be inactive). */
  subscription: UserSubscriptionRow | null;
  /** The effective tier ('free' when signed out or the subscription is inactive). */
  currentTier: string;
  refresh: () => Promise<void>;
}

interface Snapshot {
  tiers: SubscriptionTierRow[];
  subscription: UserSubscriptionRow | null;
  error: string | null;
  /** True once the load has resolved (either data or a captured error). */
  loaded: boolean;
}

const EMPTY: Snapshot = { tiers: [], subscription: null, error: null, loaded: false };

/**
 * Reads the catalogue of subscription tiers + the current user's subscription.
 * Online-only and account-gated: returns the free baseline when cloud is
 * disabled or no one is signed in, and never throws into render.
 */
export function useSubscription(): SubscriptionState {
  const { user, loading: authLoading } = useAuth();
  const online = useOnlineStatus();

  const load = useCallback(async (): Promise<Snapshot> => {
    if (!enableCloud || !user) return { ...EMPTY, loaded: true };
    try {
      // Dynamic import keeps the Supabase client off the eager graph.
      const { fetchTiers, fetchMySubscription } = await import("@/lib/billingClient");
      const [tiers, subscription] = await Promise.all([fetchTiers(), fetchMySubscription(user.id)]);
      return { tiers, subscription, error: null, loaded: true };
    } catch (e) {
      return {
        tiers: [],
        subscription: null,
        error: e instanceof Error ? e.message : "Failed to load subscription",
        loaded: true,
      };
    }
  }, [user]);

  // Re-key on user id + online so signing in/out or connectivity flips reset
  // the cached snapshot without a manual refresh() call.
  const key = `subscription:${user?.id ?? "anon"}:${online ? "on" : "off"}`;

  const { data, refresh } = useAsyncSnapshot({
    key,
    initial: EMPTY,
    load,
  });

  const currentTier = useMemo(() => effectiveTier(data.subscription), [data.subscription]);

  return {
    loading: authLoading || !data.loaded,
    error: data.error,
    tiers: data.tiers,
    subscription: data.subscription,
    currentTier,
    refresh,
  };
}
