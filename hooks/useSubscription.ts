// hooks/useSubscription.ts
import { useEffect, useState } from "react";

interface SubscriptionInfo {
  id: string;
  status: string;
  tierName: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
}

interface ProfileInfo {
  id: string;
  email: string;
  badge: string | null;
  isOgMember: boolean;
  seatNumber: number | null;
  tokens: number | null;
}

interface SubscriptionResponse {
  authenticated: boolean;
  active: boolean;
  hasProfile: boolean;
  subscription: SubscriptionInfo | null;
  profile: ProfileInfo | null;
}

export function useSubscription() {
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/api/user/subscription", {
          method: "GET",
          credentials: "include",
        });

        const json = await res.json();

        if (mounted) {
          setData(json);
        }
      } catch (err) {
        console.error("useSubscription error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    loading,
    authenticated: data?.authenticated ?? false,
    active: data?.active ?? false,
    subscription: data?.subscription ?? null,
    profile: data?.profile ?? null,
    raw: data,
  };
}

export default useSubscription;
