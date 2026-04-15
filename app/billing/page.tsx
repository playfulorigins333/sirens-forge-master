import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CreditCard,
  Crown,
  Sparkles,
  ChevronRight,
  CalendarClock,
  Shield,
  BadgeDollarSign,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { ensureActiveSubscription } from "@/lib/subscription-checker"
import { supabaseServer } from "@/lib/supabaseServer"

export const metadata = {
  title: "Sirens Forge — Billing",
}

type ProfileRow = {
  id: string
  user_id: string | null
  email: string | null
  badge: string | null
  seat_number: number | null
  tokens: number | null
}

type SubscriptionRow = {
  id: string
  status: string
  tier_name: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  canceled_at: string | null
  trial_start: string | null
  trial_end: string | null
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function prettify(value?: string | null) {
  if (!value) return "—"
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function statusPill(status?: string | null) {
  const normalized = String(status || "").toLowerCase()

  if (normalized === "active") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
  }

  if (normalized === "trialing") {
    return "border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
  }

  if (normalized === "canceled") {
    return "border-rose-500/30 bg-rose-500/15 text-rose-300"
  }

  if (normalized === "past_due") {
    return "border-amber-500/30 bg-amber-500/15 text-amber-300"
  }

  return "border-gray-700 bg-gray-800/70 text-gray-300"
}

function InfoCard(props: {
  title: string
  value: string
  subtext?: string
  icon: React.ReactNode
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-500 shadow-lg">
        {props.icon}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
        {props.title}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{props.value}</div>
      {props.subtext ? (
        <div className="mt-2 text-sm text-gray-400">{props.subtext}</div>
      ) : null}
    </section>
  )
}

export default async function BillingPage() {
  const auth = await ensureActiveSubscription()

  if (!auth.ok) {
    if (auth.error === "UNAUTHENTICATED") {
      redirect("/login")
    } else {
      redirect("/pricing")
    }
  }

  const supabase = await supabaseServer()
  const authUserId = auth.user?.id
  const authEmail = auth.user?.email ?? null

  if (!authUserId) {
    redirect("/login")
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select(
      `
      id,
      user_id,
      email,
      badge,
      seat_number,
      tokens
    `
    )
    .eq("user_id", authUserId)
    .maybeSingle()

  const profile = (profileData as ProfileRow | null) ?? null
  const profileId = profile?.id ?? auth.profile?.id ?? null

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
    .order("current_period_end", { ascending: false })

  const subscriptions = (subscriptionsData as SubscriptionRow[] | null) ?? []

  const currentSubscription =
    subscriptions.find((s) =>
      ["active", "trialing"].includes(String(s.status).toLowerCase())
    ) ??
    subscriptions[0] ??
    null

  const hasActivePlan = !!currentSubscription
  const currentTier = prettify(currentSubscription?.tier_name) || "No active plan"
  const currentStatus = prettify(currentSubscription?.status) || "No active plan"

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-black to-pink-950/60" />
        <div className="absolute top-0 left-0 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/20 blur-[140px]" />
        <div className="absolute right-0 bottom-0 h-[1000px] w-[1000px] translate-x-1/2 translate-y-1/2 rounded-full bg-pink-600/20 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pt-24 pb-16 sm:px-8">
        <div className="mb-10 max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300 backdrop-blur-xl">
            <Sparkles className="h-4 w-4" />
            Billing & Subscription
          </div>

          <h1 className="mb-4 text-4xl font-black tracking-tight sm:text-5xl md:text-6xl">
            Your plan, access, and renewal details
          </h1>

          <p className="max-w-3xl text-lg leading-relaxed font-medium text-gray-300 sm:text-xl">
            Review your current membership, billing status, and what your active
            plan unlocks inside Sirens Forge.
          </p>

          <p className="mt-3 text-sm text-gray-400">
            Billing account: <span className="text-gray-200">{profile?.email || authEmail || "—"}</span>
          </p>
        </div>

        {!hasActivePlan ? (
          <section className="mb-10 rounded-[28px] border border-amber-500/30 bg-amber-500/10 p-6 backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg">
                <AlertTriangle className="h-6 w-6 text-black" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">No active subscription found</h2>
                <p className="mt-2 max-w-2xl text-sm text-gray-300">
                  Your account does not currently show an active paid plan. Visit pricing
                  to unlock access or restore your membership state.
                </p>
                <div className="mt-4">
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
                  >
                    View Pricing
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard
            title="Current Plan"
            value={currentTier}
            subtext="Your active membership tier"
            icon={<Crown className="h-6 w-6 text-white" />}
          />

          <InfoCard
            title="Status"
            value={currentStatus}
            subtext="Current billing / access state"
            icon={<CheckCircle2 className="h-6 w-6 text-white" />}
          />

          <InfoCard
            title="Current Period Ends"
            value={formatDate(currentSubscription?.current_period_end)}
            subtext="Renewal or billing cycle end"
            icon={<CalendarClock className="h-6 w-6 text-white" />}
          />

          <InfoCard
            title="Tokens"
            value={String(profile?.tokens ?? 0)}
            subtext="Current token balance on account"
            icon={<BadgeDollarSign className="h-6 w-6 text-white" />}
          />
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <section className="rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-950/20 via-black/50 to-purple-950/30 p-8 backdrop-blur-xl lg:col-span-2">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
              <CreditCard className="h-7 w-7 text-white" />
            </div>

            <h2 className="mb-4 text-2xl font-bold text-white">Subscription details</h2>

            {currentSubscription ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Tier
                  </div>
                  <div className="mt-1 text-base text-gray-200">
                    {prettify(currentSubscription.tier_name)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Status
                  </div>
                  <div className="mt-2">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusPill(
                        currentSubscription.status
                      )}`}
                    >
                      {prettify(currentSubscription.status)}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Current Period Start
                  </div>
                  <div className="mt-1 text-base text-gray-200">
                    {formatDate(currentSubscription.current_period_start)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Current Period End
                  </div>
                  <div className="mt-1 text-base text-gray-200">
                    {formatDate(currentSubscription.current_period_end)}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Cancel At Period End
                  </div>
                  <div className="mt-1 text-base text-gray-200">
                    {currentSubscription.cancel_at_period_end ? "Yes" : "No"}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    Trial Window
                  </div>
                  <div className="mt-1 text-base text-gray-200">
                    {currentSubscription.trial_start || currentSubscription.trial_end
                      ? `${formatDate(currentSubscription.trial_start)} → ${formatDate(
                          currentSubscription.trial_end
                        )}`
                      : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-300">No subscription details available.</p>
            )}
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 shadow-lg">
              <Shield className="h-7 w-7 text-white" />
            </div>

            <h2 className="mb-4 text-2xl font-bold text-white">Plan actions</h2>

            <div className="space-y-3">
              <Link
                href="/pricing"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                View Pricing
                <ChevronRight className="h-4 w-4" />
              </Link>

              <Link
                href="/account"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                Go to Account
                <ChevronRight className="h-4 w-4" />
              </Link>

              <Link
                href="/dashboard"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/10"
              >
                Back to Dashboard
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
              Stripe customer portal controls can be added here later for:
              upgrade, cancel, and billing management.
            </div>
          </section>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-500 shadow-lg">
              <Crown className="h-7 w-7 text-white" />
            </div>

            <h3 className="mb-3 text-2xl font-bold text-white">
              What your plan unlocks
            </h3>

            <ul className="space-y-3 text-sm text-gray-300">
              <li>Dashboard access and member routing</li>
              <li>Generator access for image and future video workflows</li>
              <li>Siren&apos;s Mind prompt workflow</li>
              <li>Vault access for saved outputs</li>
              <li>AI Twin / LoRA training access based on your product structure</li>
            </ul>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
              <BadgeDollarSign className="h-7 w-7 text-white" />
            </div>

            <h3 className="mb-3 text-2xl font-bold text-white">
              Billing notes
            </h3>

            <div className="space-y-3 text-sm text-gray-300">
              <p>
                This page is pulling your live subscription details from Supabase so
                users can clearly see what plan they are on and when their period ends.
              </p>
              <p>
                The next future upgrade here is Stripe portal management for
                self-serve billing changes.
              </p>
              <p>
                Badge: <span className="text-gray-200">{profile?.badge || "—"}</span>
              </p>
              <p>
                Seat number: <span className="text-gray-200">{profile?.seat_number ?? "—"}</span>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}