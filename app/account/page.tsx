import Link from "next/link";
import { redirect } from "next/navigation";
import {
  User,
  Crown,
  CreditCard,
  Shield,
  Sparkles,
  ChevronRight,
  Library,
  Wand2,
  Brain,
} from "lucide-react";
import { ensureAuthenticatedProfile } from "@/lib/account-access";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasCurrentMaterialPolicyAcceptance } from "@/lib/material-policy/service";
import { getSubscriptionRetentionSummary } from "@/lib/subscription-retention";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sirens Forge — Account",
};

type ProfileRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  badge: string | null;
  seat_number: number | null;
};

type SubscriptionRow = {
  id: string;
  status: string;
  tier_name: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function prettyTierName(value?: string | null) {
  if (!value) return "No active plan";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusPill(status?: string | null) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "active") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  }

  if (normalized === "trialing") {
    return "border-cyan-500/30 bg-cyan-500/15 text-cyan-300";
  }

  if (normalized === "canceled") {
    return "border-rose-500/30 bg-rose-500/15 text-rose-300";
  }

  return "border-gray-700 bg-gray-800/70 text-gray-300";
}

export default async function AccountPage() {
  const auth = await ensureAuthenticatedProfile();

  if (auth.ok === false) {
    if (auth.error === "UNAUTHENTICATED") redirect("/login");
    throw new Error(auth.message);
  }

  const supabase = await supabaseServer();
  const authEmail = auth.user.email;
  const profile = auth.profile;
  const profileId = profile.id;

  const { data: subscriptionsData } = await supabase
    .from("user_subscriptions")
    .select(
      `
      id,
      status,
      tier_name,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      canceled_at,
      trial_start,
      trial_end
    `
    )
    .eq("user_id", profileId)
    .order("current_period_end", { ascending: false });

  const subscriptions = (subscriptionsData as SubscriptionRow[] | null) ?? [];
  const activeSubscription =
    subscriptions.find((s) => ["active", "trialing"].includes(String(s.status).trim().toLowerCase())) ?? null;
  const latestSubscription = subscriptions[0] ?? null;
  const displaySubscription = activeSubscription ?? latestSubscription;
  const hasActivePlan = activeSubscription !== null;
  const policyAccepted = await hasCurrentMaterialPolicyAcceptance(auth.user.id, profileId).catch(() => false);
  const retention = await getSubscriptionRetentionSummary(auth.user.id, profileId).catch(() => null);
  const retainedReadOnly = retention && new Date(retention.paidAccessEndedAt).getTime() <= Date.now() && new Date(retention.retentionUntil).getTime() > Date.now() && !hasActivePlan;
  const scheduledCancellation = activeSubscription?.tier_name !== "og_throne" && activeSubscription?.cancel_at_period_end && activeSubscription.current_period_end;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-black to-pink-950/60" />
        <div className="absolute top-0 left-0 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/20 blur-[140px]" />
        <div className="absolute right-0 bottom-0 h-[1000px] w-[1000px] translate-x-1/2 translate-y-1/2 rounded-full bg-pink-600/20 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pt-24 pb-16 sm:px-8">
        {/* Header */}
        <div className="mb-10 max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300 backdrop-blur-xl">
            <Sparkles className="h-4 w-4" />
            Account & Settings
          </div>

          <h1 className="mb-4 text-4xl font-black tracking-tight sm:text-5xl md:text-6xl">
            Your account, access, and membership
          </h1>

          <p className="max-w-3xl text-lg leading-relaxed font-medium text-gray-300 sm:text-xl">
            Review your Sirens Forge membership, account details, and the plan tied to your creator access.
          </p>
        </div>

        {scheduledCancellation ? <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-50"><strong>Cancels at period end.</strong> Normal paid access continues through {formatDate(activeSubscription.current_period_end)}.</section> : null}
        {retainedReadOnly ? <section className="mb-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-5 text-cyan-50"><strong>Creator data is in read-only retention.</strong> Paid access ended {formatDate(retention.paidAccessEndedAt)}; retained access is available through {formatDate(retention.retentionUntil)}. <span className="ml-2 inline-flex gap-3 underline"><Link href="/library">Library</Link><Link href="/account/data-rights">Privacy &amp; Data</Link><Link href="/billing">Billing</Link></span></section> : null}

        {/* Top cards */}
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
              <User className="h-7 w-7 text-white" />
            </div>

            <h2 className="mb-4 text-2xl font-bold text-white">Profile</h2>

            <div className="space-y-3 text-sm">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                  Email
                </div>
                <div className="mt-1 text-gray-200">{profile?.email || authEmail || "—"}</div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                  Badge
                </div>
                <div className="mt-1 text-gray-200">{profile?.badge || "—"}</div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                  Seat Number
                </div>
                <div className="mt-1 text-gray-200">
                  {profile?.seat_number ?? "—"}
                </div>
              </div>

            </div>
          </section>

          <section className="rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-950/20 via-black/50 to-purple-950/30 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
              <CreditCard className="h-7 w-7 text-white" />
            </div>

            <h2 className="mb-4 text-2xl font-bold text-white">{hasActivePlan ? "Current Plan" : "Latest / Inactive Membership"}</h2>

            {displaySubscription ? (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Tier
                  </div>
                  <div className="mt-1 text-gray-200">
                    {prettyTierName(displaySubscription.tier_name)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Status
                  </div>
                  <div className="mt-2">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusPill(
                        displaySubscription.status
                      )}`}
                    >
                      {prettyTierName(displaySubscription.status)}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Current Period Ends
                  </div>
                  <div className="mt-1 text-gray-200">
                    {formatDate(displaySubscription.current_period_end)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Cancel At Period End
                  </div>
                  <div className="mt-1 text-gray-200">
                    {displaySubscription.cancel_at_period_end ? "Yes" : "No"}
                  </div>
                </div>
                {!hasActivePlan ? <div className="flex gap-3 pt-2"><Link href="/billing" className="text-cyan-300 hover:text-cyan-200">Billing</Link><Link href="/pricing" className="text-cyan-300 hover:text-cyan-200">View Pricing</Link></div> : null}
              </div>
            ) : (
              <div className="space-y-3 text-sm text-gray-300">
                <p>No active plan and no subscription history found.</p>
                <div className="flex gap-3"><Link href="/billing" className="text-cyan-300 hover:text-cyan-200">Billing</Link><Link href="/pricing" className="text-cyan-300 hover:text-cyan-200">View Pricing</Link></div>
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-pink-400/20 bg-gradient-to-br from-pink-950/30 via-black/50 to-purple-950/30 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 shadow-lg">
              <Shield className="h-7 w-7 text-white" />
            </div>

            <h2 className="mb-4 text-2xl font-bold text-white">Quick Actions</h2>

            <div className="space-y-3">
              <Link
                href="/dashboard"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                Back to Dashboard
                <ChevronRight className="h-4 w-4" />
              </Link>

              <Link
                href="/pricing"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                View Pricing
                <ChevronRight className="h-4 w-4" />
              </Link>

              <Link
                href="/library"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                Open Creation Loop
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </div>

        {/* Lower section */}
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-500 shadow-lg">
              <Crown className="h-7 w-7 text-white" />
            </div>

            <h3 className="mb-3 text-2xl font-bold text-white">
              Membership details
            </h3>

            <div className="space-y-3 text-sm text-gray-300">
              <p>
                Review your current membership and access status here at any time.
              </p>
              <p>
                Visit Billing to manage your subscription, or compare available membership options on Pricing.
              </p>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
              <Library className="h-7 w-7 text-white" />
            </div>

            <h3 className="mb-3 text-2xl font-bold text-white">
              Creator shortcuts
            </h3>

            <div className="grid gap-3 sm:grid-cols-3">
              <Link
                href="/sirens-mind"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-300" />
                  <span>Siren&apos;s Mind</span>
                </div>
                <div className="text-xs text-gray-400">Guided prompts</div>
              </Link>

              <Link
                href="/generate"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-cyan-300" />
                  <span>Generator</span>
                </div>
                <div className="text-xs text-gray-400">Direct creation</div>
              </Link>

              <Link
                href="/lora/train"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                <div className="mb-2 flex items-center gap-2">
                  <User className="h-4 w-4 text-pink-300" />
                  <span>AI Twin</span>
                </div>
                <div className="text-xs text-gray-400">Train identity</div>
              </Link>
            </div>
          </section>
        </div>
        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <h3 className="mb-3 text-2xl font-bold text-white">Material policy status</h3>
          <p className={policyAccepted ? "mb-3 text-emerald-300" : "mb-3 text-amber-300"}>{policyAccepted ? "Current bundle accepted" : "Action required"}</p>
          <Link className="text-cyan-300 hover:text-cyan-200" href="/account/policy-consent?next=%2Faccount">{policyAccepted ? "Review current policy receipt status" : "Review and accept current policies"}</Link>
        </section>
        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <h3 className="mb-3 text-2xl font-bold text-white">Security</h3>
          <p className="mb-3 text-gray-300">Manage optional authenticator-app two-factor authentication.</p>
          <Link className="text-cyan-300 hover:text-cyan-200" href="/account/security">Security settings</Link>
        </section>
        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
          <h3 className="mb-3 text-2xl font-bold text-white">Privacy and safety resources</h3>
          <p className="mb-4 text-sm text-gray-300">Review our policies or reach the existing support and removal processes.</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="text-cyan-300 hover:text-cyan-200" href="/privacy">Privacy</Link>
            <Link className="text-cyan-300 hover:text-cyan-200" href="/content-removal">Content Removal</Link>
            <Link className="text-cyan-300 hover:text-cyan-200" href="/report-intimate-content">Report Intimate Content</Link>
            <Link className="text-cyan-300 hover:text-cyan-200" href="/contact">Contact Support</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
