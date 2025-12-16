// lib/subscription-checker.ts
export type ActiveSubscriptionResult = {
  ok: boolean;
  user?: any;
  subscription?: any;
  error?: string;
  message?: string;
  status?: number;
};

/**
 * TEMPORARY LAUNCH PATCH
 * ----------------------
 * Auth + subscription enforcement is DISABLED
 * so backend + generator can be built safely.
 *
 * This WILL be re-enabled later.
 */
export async function ensureActiveSubscription(): Promise<ActiveSubscriptionResult> {
  return {
    ok: true,
    user: {
      id: "dev-user",
      email: "admin@sirensforge.vip",
    },
    subscription: {
      tier_name: "admin",
      status: "active",
      bypass: true,
    },
  };
}
