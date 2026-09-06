"use client";

import { useEffect, useState } from "react";
import { motion, animate } from "framer-motion";
import { useSearchParams } from "next/navigation";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Crown, Star, Sparkles, AlertTriangle, Check } from "lucide-react";
import { captureReferral, clearStoredReferral, normalizeReferralCode, readCurrentReferral } from "@/lib/referralAttribution";
import { MATERIAL_POLICY_MANIFEST } from "@/lib/material-policy/manifest";
import Link from "next/link";

type ViewMode = "cards" | "compare";
type CheckoutTier = "og_throne" | "early_bird";
type PublicTierState = "available" | "unavailable" | "sold_out";
type PublicPurchaseState = { checkoutMode: "payment_v2"; tiers?: Record<CheckoutTier, PublicTierState> };

interface TierSeats {
  remaining: number;
  total: number;
  active: boolean;
}

interface SeatState {
  og: TierSeats;
  earlyBird: TierSeats;
}

interface SeatCountTier {
  max_slots: number | null;
  slots_remaining: number | null;
  is_active?: boolean | null;
}

interface SeatCountApiResponse {
  success: boolean;
  tiers: {
    og_throne?: SeatCountTier;
    early_bird?: SeatCountTier;
    [key: string]: SeatCountTier | undefined;
  };
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

// Small helper to animate numeric transitions (seat counters)
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState<number>(value);

  useEffect(() => {
    // ensure start point tracks the last displayed value
    const controls = animate(display, value, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });

    return () => {
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span>{display.toLocaleString()}</span>;
}

function SeatCounterText({
  tier,
  fullCapacityLabel = "founder spots remaining",
}: {
  tier: TierSeats;
  fullCapacityLabel?: "founder spots remaining" | "spots remaining";
}) {
  if (tier.remaining === tier.total) {
    return <span>{tier.total.toLocaleString()} {fullCapacityLabel}</span>;
  }

  return (
    <>
      <AnimatedNumber value={tier.remaining} />
      <span className="mx-0.5">/</span>
      <AnimatedNumber value={tier.total} />
      <span> seats left</span>
    </>
  );
}

export default function PricingClient() {
  const [viewMode, setViewMode] = useState<ViewMode>("compare");

  // ✅ NO FALLBACK NUMBERS. Seats are authoritative from /api/subscription/seat-count only.
  // null = not yet hydrated
  const [seats, setSeats] = useState<SeatState | null>(null);
  const [loadingSeats, setLoadingSeats] = useState<boolean>(false);

  const [checkoutLoading, setCheckoutLoading] = useState<CheckoutTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [publicPurchase, setPublicPurchase] = useState<PublicPurchaseState | null>(null);

  // Referral / affiliate code
  const searchParams = useSearchParams();
  const [referralCode, setReferralCode] = useState<string>("");
  const [referralSaved, setReferralSaved] = useState<boolean>(false);

  const paymentV2 = publicPurchase?.checkoutMode === "payment_v2";
  const ogSoldOut = paymentV2 && (publicPurchase.tiers?.og_throne === "sold_out" || (seats ? seats.og.remaining <= 0 : false));
  const earlyBirdSoldOut = paymentV2 && (publicPurchase.tiers?.early_bird === "sold_out" || (seats ? seats.earlyBird.remaining <= 0 : false));
  const ogUnavailable = paymentV2 && publicPurchase.tiers?.og_throne === "unavailable";
  const earlyBirdUnavailable = paymentV2 && publicPurchase.tiers?.early_bird === "unavailable";
  const ogActive = paymentV2 && publicPurchase.tiers?.og_throne === "available";
  const earlyBirdActive = paymentV2 && publicPurchase.tiers?.early_bird === "available";
  const availabilityLoaded = paymentV2 && Boolean(publicPurchase.tiers);

  useEffect(() => {
    let active = true;
    fetch("/api/payment-v2/readiness", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((value: unknown) => {
        if (!active || !value || typeof value !== "object") return;
        const state = value as PublicPurchaseState;
        if (state.checkoutMode === "payment_v2") setPublicPurchase(state);
      })
      .catch(() => { /* Loading remains fail closed. */ });
    return () => { active = false; };
  }, []);

  // Hydrate referral code from URL (?ref=CODE) or localStorage
  useEffect(() => {
    if (!publicPurchase) return;
    try {
      const fromUrl =
        (searchParams?.get("ref") ||
          searchParams?.get("r") ||
          searchParams?.get("code") ||
          "")?.trim();

      if (typeof window === "undefined") return;
      const supplied = fromUrl ? captureReferral(window.localStorage, fromUrl, Date.now()) : null;
      const current = supplied || readCurrentReferral(window.localStorage, Date.now());
      setReferralCode(current || "");
      setReferralSaved(Boolean(current));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, publicPurchase]);

  // ✅ Live seat polling – wired to /api/subscription/seat-count (authoritative)
  useEffect(() => {
    if (!publicPurchase) return;
    let active = true;

    const fetchSeats = async () => {
      try {
        setLoadingSeats(true);

        const res = await fetch("/api/subscription/seat-count", {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error("Seat endpoint not ready");
        }

        const data = (await res.json()) as SeatCountApiResponse;

        if (!active) return;
        if (!data?.success || !data?.tiers) {
          throw new Error("Seat response invalid");
        }

        const ogTier = data.tiers.og_throne;
        const ebTier = data.tiers.early_bird;

        const ogRemaining = ogTier?.slots_remaining;
        const ogTotal = ogTier?.max_slots;

        const ebRemaining = ebTier?.slots_remaining;
        const ebTotal = ebTier?.max_slots;

        // Require valid numbers to hydrate/update — prevents accidental drift
        if (
          !isFiniteNumber(ogRemaining) || ogTotal !== 50 ||
          !isFiniteNumber(ebRemaining) || ebTotal !== 150 ||
          !Number.isInteger(ogRemaining) || ogRemaining < 0 || ogRemaining > 50 ||
          !Number.isInteger(ebRemaining) || ebRemaining < 0 || ebRemaining > 150 ||
          typeof ogTier?.is_active !== "boolean" || typeof ebTier?.is_active !== "boolean"
        ) {
          throw new Error("Seat numbers missing");
        }

        setSeats({
          og: { remaining: ogRemaining, total: ogTotal, active: ogTier.is_active },
          earlyBird: { remaining: ebRemaining, total: ebTotal, active: ebTier.is_active },
        });
      } catch {
        // Do nothing — keep last known good state.
        // If we haven't hydrated yet, seats remain null (shows "Loading…" instead of fake numbers).
      } finally {
        if (active) setLoadingSeats(false);
      }
    };

    // hydrate immediately
    fetchSeats();

    // poll every 15s
    const interval = setInterval(fetchSeats, 15_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [publicPurchase?.checkoutMode]);

  const handleCheckout = async (tierName: CheckoutTier) => {
    try {
      setCheckoutError(null);

      if (!policiesAccepted) {
        setCheckoutError("Please accept the Terms of Service, Privacy Policy, and Acceptable Use Policy before checkout.");
        document.getElementById("checkout-policy-acceptance")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      setCheckoutLoading(tierName);

      if (publicPurchase?.checkoutMode !== "payment_v2") throw new Error("Checkout is unavailable.");
      const res = await fetch("/api/checkout/subscription-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // PRICING PAGE IS PUBLIC (NO AUTH). Stripe Checkout happens first.
        body: JSON.stringify({ tierName, ...(normalizeReferralCode(referralCode) ? { referralCode: normalizeReferralCode(referralCode)! } : {}), materialPolicyAcceptance: { accepted: policiesAccepted, materialBundleVersion: MATERIAL_POLICY_MANIFEST.materialBundleVersion } }),
      });

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const msg =
          json?.error ||
          (res.status === 409 ? "That tier is sold out." : "Checkout failed. Please try again.");
        setCheckoutError(msg);
        return;
      }

      if (!json?.url) {
        setCheckoutError("Checkout session missing URL.");
        return;
      }

      window.location.href = json.url as string;
    } catch (e: any) {
      setCheckoutError(e?.message || "Checkout failed. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  };

  const compareRows: {
    label: string;
    og: string;
    earlyBird: string;
    highlight?: "og" | "earlybird";
  }[] = [
    {
      label: "Pricing",
      og: "$1,333 one-time",
      earlyBird: "$29.99/month",
      highlight: "earlybird",
    },
    {
      label: "Availability",
      og: "50 total seats",
      earlyBird: "150 total seats",
      highlight: "og",
    },
    {
      label: "Affiliate % (first 6 months)",
      og: "50%",
      earlyBird: "20%",
      highlight: "og",
    },
    {
      label: "Affiliate % (lifetime after 6 months)",
      og: "25%",
      earlyBird: "10%",
      highlight: "og",
    },
    {
      label: "Founding Recognition",
      og: "OG Eternal Throne / permanent OG Founder recognition",
      earlyBird: "Permanent Early Bird founder recognition",
      highlight: "og",
    },
    {
      label: "Access",
      og: "Lifetime founder access — no recurring subscription",
      earlyBird: "$29.99/month founder access while subscription remains active",
      highlight: "og",
    },
    {
      label: "Best For",
      og: "Creators serious about scaling and building an empire",
      earlyBird: "Creators ready to go all-in at a flexible monthly rate",
      highlight: "earlybird",
    },
  ];

  const canCheckout = availabilityLoaded && checkoutLoading === null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-black text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-purple-700/30 blur-3xl rounded-full" />
        <div className="absolute top-40 -right-40 w-80 h-80 bg-pink-500/30 blur-3xl rounded-full" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[32rem] h-72 bg-cyan-500/20 blur-3xl rounded-full" />
      </div>

      {/* Fine grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,#1f2937_1px,transparent_0)] [background-size:24px_24px] opacity-25"
      />

      <main className="relative z-10 max-w-6xl mx-auto px-4 pt-8 pb-20 md:pt-14">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-6"
        >
          <div className="space-y-3 md:space-y-4 text-center md:text-left">
            <p className="text-xs tracking-[0.3em] uppercase text-purple-300/80">
              SirensForge Access
            </p>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
              Choose your entry tier
            </h1>
            <p className="text-gray-400 text-sm md:text-base max-w-xl mx-auto md:mx-0">
              Lock in OG or Early Bird founder benefits while seats remain. Seats update in real time as
              founders join. Founder pricing is available only while these limited founder seats remain.
            </p>
          </div>

          {/* View toggle */}
          <div className="flex items-center justify-center md:justify-end gap-3">
            <div className="inline-flex items-center rounded-full bg-slate-900/80 border border-slate-700/70 p-1 shadow-[0_0_30px_rgba(15,23,42,0.85)] backdrop-blur">
              <button
                onClick={() => setViewMode("cards")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  viewMode === "cards"
                    ? "bg-slate-100 text-slate-900 shadow-[0_0_12px_rgba(148,163,184,0.8)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Card View
              </button>
              <button
                onClick={() => setViewMode("compare")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  viewMode === "compare"
                    ? "bg-slate-100 text-slate-900 shadow-[0_0_12px_rgba(148,163,184,0.8)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Comparison View
              </button>
            </div>
          </div>
        </motion.header>

        {/* Status strip */}
        <motion.section
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.7, ease: "easeOut" }}
          className="mt-6 mb-6 md:mb-10"
        >
          <div className="relative grid grid-cols-1 gap-4 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 shadow-[0_0_35px_rgba(15,23,42,0.9)] md:px-5 md:py-3.5 lg:grid-cols-[minmax(280px,1fr)_minmax(240px,0.8fr)_minmax(300px,1fr)] lg:items-center">
            {/* Glow accent */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-purple-500/40 to-transparent"
            />

            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 blur-md bg-purple-500/40" />
                <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 shadow-[0_0_25px_rgba(168,85,247,0.9)]">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="text-xs md:text-sm">
                <p className="font-semibold text-slate-50">Live Founder Seat Tracking</p>
                <p className="text-slate-400">
                  Availability updates as seats are reserved or purchased.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-[auto_5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-[11px] text-slate-400 md:text-xs">
              <div className="contents">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                <span className="whitespace-nowrap">OG</span>
                <span className="font-semibold text-slate-100 lg:whitespace-nowrap">
                  {!availabilityLoaded ? (
                    <span className="text-slate-500">Loading…</span>
                  ) : ogUnavailable ? (
                    <span className="text-slate-400">Currently unavailable</span>
                  ) : ogSoldOut ? (
                    <span className="text-amber-300">SOLD OUT</span>
                  ) : !seats ? (
                    <span className="text-slate-500">Loading…</span>
                  ) : (
                    <SeatCounterText tier={seats.og} />
                  )}
                </span>
              </div>

              <div className="contents">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-pink-400 animate-pulse shadow-[0_0_12px_rgba(244,114,182,0.8)]" />
                <span className="whitespace-nowrap">Early Bird</span>
                <span className="font-semibold text-slate-100 lg:whitespace-nowrap">
                  {!availabilityLoaded ? (
                    <span className="text-slate-500">Loading…</span>
                  ) : earlyBirdUnavailable ? (
                    <span className="text-slate-400">Currently unavailable</span>
                  ) : earlyBirdSoldOut ? (
                    <span className="text-amber-300">SOLD OUT</span>
                  ) : !seats ? (
                    <span className="text-slate-500">Loading…</span>
                  ) : (
                    <SeatCounterText tier={seats.earlyBird} fullCapacityLabel="spots remaining" />
                  )}
                </span>
              </div>

              {loadingSeats && (
                <p className="col-span-3 text-[10px] text-slate-500">Syncing with live seat data…</p>
              )}
            </div>

            <div className="w-full min-w-0">
              {paymentV2 ? (
              <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                  Referral / affiliate code
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={referralCode}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/\s+/g, "");
                      setReferralCode(v);
                      try {
                        const saved = captureReferral(window.localStorage, v, Date.now());
                        if (!v) clearStoredReferral(window.localStorage);
                        setReferralSaved(Boolean(saved));
                      } catch {
                        // ignore
                      }
                    }}
                    placeholder="Example: USER9389"
                    className="w-full rounded-lg bg-slate-900/70 border border-slate-700/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-purple-400/70 focus:ring-2 focus:ring-purple-500/20"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {referralCode ? (
                    <span className="text-[10px] font-semibold text-emerald-300 whitespace-nowrap">
                      {referralSaved ? "Saved" : "OK"}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-amber-200 whitespace-nowrap">
                      Required for commission
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  If you&apos;re supporting an affiliate, enter their code before checkout. No code = no commission.
                </p>
              </div>
              ) : (
                <div className="rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-xs text-slate-400">Affiliate controls are unavailable while Checkout mode is loading.</div>
              )}
            </div>
          </div>
        </motion.section>

        <section id="checkout-policy-acceptance" className="mb-6 rounded-2xl border border-cyan-400/30 bg-cyan-950/20 px-4 py-4 text-sm text-slate-200">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={policiesAccepted}
              onChange={(event) => {
                setPoliciesAccepted(event.target.checked);
                if (event.target.checked) setCheckoutError(null);
              }}
              className="mt-1 h-4 w-4 accent-cyan-400"
            />
            <span>
              I have read and agree to the <Link className="text-cyan-300 underline" href="/terms" target="_blank">Terms of Service</Link>,{" "}
              <Link className="text-cyan-300 underline" href="/privacy" target="_blank">Privacy Policy</Link>, and{" "}
              <Link className="text-cyan-300 underline" href="/acceptable-use" target="_blank">Acceptable Use Policy</Link>.
              This box is required before Checkout and is not selected by default.
            </span>
          </label>
        </section>

        {/* Checkout error */}
        {checkoutError && (
          <div className="mb-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300" />
            <div>
              <p className="font-semibold text-amber-100">Checkout error</p>
              <p className="text-amber-100/90">{checkoutError}</p>
            </div>
          </div>
        )}

        {/* Main content */}
        {viewMode === "cards" ? (
          <>
            {/* Cards layout */}
            <section className="grid gap-6 md:gap-8 md:grid-cols-2 items-stretch mb-10">
              {/* OG THRONE */}
              <motion.div
                initial={{ opacity: 0, y: 25, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                whileHover={{ y: -8, scale: 1.02, rotateX: -1.5, rotateY: -1.5 }}
                className="transform-gpu"
              >
                <Card className="relative h-full border border-purple-600/70 bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-950/90 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(168,85,247,0.45)]">
                  <AnimatedBadge label="Lifetime Elite" className="left-4 top-4" />
                  <AnimatedGlow className="bg-purple-500/40" />

                  {/* Selling fast micro banner when <= 10 and > 0 */}
                  {!paymentV2 && seats?.og.active && seats.og.remaining > 0 && seats.og.remaining <= 10 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="absolute right-3 top-4 z-10 rounded-full bg-amber-500/10 border border-amber-400/60 px-2 py-1 flex items-center gap-1.5 text-[10px] font-semibold text-amber-200"
                    >
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse shadow-[0_0_10px_rgba(252,211,77,0.9)]" />
                      <span>Only {seats.og.remaining} left</span>
                    </motion.div>
                  )}

                  <CardHeader className="pt-12">
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="relative">
                        <div className="absolute inset-0 blur-md bg-purple-500/50" />
                        <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-300 shadow-[0_0_28px_rgba(168,85,247,1)]">
                          <Crown className="w-5 h-5 text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.95)]" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-purple-200/80">
                          OG Eternal Throne
                        </p>
                        <CardTitle className="text-xl font-bold text-white">Founding Empire Tier</CardTitle>
                      </div>
                    </div>

                    <CardDescription className="text-sm text-gray-300/95 text-center max-w-xs mx-auto">
                      Secure <span className="font-semibold">lifetime founder access</span> to SirensForge with
                      the highest founder commissions, permanent OG Founder recognition, and no recurring subscription.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-6 pb-6">
                    <ul className="space-y-2.5 text-gray-200 text-sm">
                      <li>
                        • <strong>50% commission</strong> on subscription referrals (first 6 months)
                      </li>
                      <li>
                        • <strong>25% lifetime commission</strong> on subscriptions after 6 months
                      </li>
                      <li>• Permanent OG Founder status and top-tier platform recognition</li>
                      <li>• Lifetime founder access</li>
                      <li>
                        • Locked-in <strong>lifetime deal</strong> — pay once, never again.
                      </li>
                    </ul>

                    <div className="space-y-3">
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <div className="text-5xl font-black tracking-tight bg-gradient-to-r from-purple-200 via-white to-purple-200 bg-clip-text text-transparent">
                          $1,333
                        </div>
                        <div className="text-gray-400 text-xs uppercase tracking-[0.25em]">One-time • Lifetime</div>
                      </div>

                      <div className="flex flex-col items-center gap-1.5 text-xs text-gray-300">
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/90 border border-purple-500/70 px-3 py-1 shadow-[0_0_25px_rgba(168,85,247,0.9)]">
                          {!availabilityLoaded ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                              <span className="font-semibold text-slate-300">
                                <span className="uppercase tracking-[0.18em] text-[9px] mr-1">OG Seats</span>
                                Loading…
                              </span>
                            </>
                          ) : ogUnavailable ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              <span className="font-semibold text-slate-300">Currently unavailable</span>
                            </>
                          ) : ogSoldOut ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span className="font-semibold text-amber-200">SOLD OUT</span>
                            </>
                          ) : !seats ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                              <span className="font-semibold text-slate-300">Loading…</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                              <span className="font-semibold text-amber-100">
                                <span className="uppercase tracking-[0.18em] text-[9px] mr-1">OG Seats</span>
                                <SeatCounterText tier={seats.og} />
                              </span>
                            </>
                          )}
                        </div>
                        <span className="block text-xs text-gray-400 max-w-xs mx-auto">
                          Secure one of the final OG Founder slots and lock in elite affiliate benefits for life.
                        </span>
                      </div>

                      <NeonButton
                        disabled={!canCheckout || !ogActive || ogSoldOut}
                        loading={checkoutLoading === "og_throne"}
                        label={!availabilityLoaded ? "Loading availability…" : ogUnavailable ? "Currently unavailable" : ogSoldOut ? "OG Seats Sold Out" : "Claim OG Throne"}
                        sublabel={
                          !availabilityLoaded
                            ? "Seat counter is syncing…"
                            : ogUnavailable
                            ? "This launch tier is inactive."
                            : ogSoldOut
                            ? "Join Early Bird below instead."
                            : "Lifetime elite access • No recurring payment"
                        }
                        onClick={() => ogActive && !ogSoldOut && handleCheckout("og_throne")}
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* EARLY BIRD */}
              <motion.div
                initial={{ opacity: 0, y: 25, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.1, duration: 0.7, ease: "easeOut" }}
                whileHover={{ y: -8, scale: 1.02, rotateX: 1.5, rotateY: 1.5 }}
                className="transform-gpu"
              >
                <Card className="relative h-full border border-pink-500/80 bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-950/90 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(236,72,153,0.45)]">
                  <AnimatedBadge label="Best Value" className="left-4 top-4" />
                  <AnimatedGlow className="bg-pink-500/40" />

                  <CardHeader className="pt-12">
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="relative">
                        <div className="absolute inset-0 blur-md bg-pink-500/60" />
                        <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-pink-300 shadow-[0_0_28px_rgba(236,72,153,1)]">
                          <Star className="w-5 h-5 text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.95)]" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-pink-100/80">Early Bird Access</p>
                        <CardTitle className="text-xl font-bold text-white">Founding Monthly Tier</CardTitle>
                      </div>
                    </div>

                    <CardDescription className="text-sm text-gray-300/95 text-center max-w-xs mx-auto">
                      Lock in a <span className="font-semibold">$29.99</span> monthly rate before prices rise. Strong commissions,
                      full access, and founder recognition baked in.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-6 pb-6">
                    <ul className="space-y-2.5 text-gray-200 text-sm">
                      <li>
                        • Affiliate: <strong>20%</strong> first 6 months, <strong>10% lifetime</strong>
                      </li>
                      <li>• 10% commission on one-time purchases</li>
                      <li>• Permanent Early Bird founder recognition</li>
                    </ul>

                    <div className="space-y-3">
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <div className="text-4xl font-extrabold tracking-tight">$29.99</div>
                        <div className="text-gray-400 text-xs uppercase tracking-[0.25em]">Per month</div>
                      </div>

                      <div className="flex flex-col items-center gap-1.5 text-xs text-gray-300">
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/90 border border-pink-500/70 px-3 py-1 shadow-[0_0_25px_rgba(236,72,153,0.9)]">
                          {!availabilityLoaded ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                              <span className="font-semibold text-slate-300">
                                <span className="uppercase tracking-[0.18em] text-[9px] mr-1">Early Bird</span>
                                Loading…
                              </span>
                            </>
                          ) : earlyBirdUnavailable ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              <span className="font-semibold text-slate-300">Currently unavailable</span>
                            </>
                          ) : earlyBirdSoldOut ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span className="font-semibold text-amber-200">SOLD OUT</span>
                            </>
                          ) : !seats ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                              <span className="font-semibold text-slate-300">Loading…</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-pink-300 animate-pulse" />
                              <span className="font-semibold text-pink-100">
                                <span className="uppercase tracking-[0.18em] text-[9px] mr-1">Early Bird</span>
                                <SeatCounterText tier={seats.earlyBird} fullCapacityLabel="spots remaining" />
                              </span>
                            </>
                          )}
                        </div>
                        <span className="block text-xs text-gray-400 max-w-xs mx-auto">
                          Early Bird is one of two Payment-First launch tiers. This is the{" "}
                          <span className="font-semibold">sweet spot</span> for most creators.
                        </span>
                      </div>

                      <div className="flex justify-center">
                        <NeonButton
                          disabled={!canCheckout || !earlyBirdActive || earlyBirdSoldOut}
                          loading={checkoutLoading === "early_bird"}
                          label={!availabilityLoaded ? "Loading availability…" : earlyBirdUnavailable ? "Currently unavailable" : earlyBirdSoldOut ? "Early Bird Sold Out" : "Join Early Bird"}
                          sublabel={
                            !availabilityLoaded
                              ? "Seat counter is syncing…"
                              : earlyBirdUnavailable
                              ? "This launch tier is inactive."
                              : earlyBirdSoldOut
                              ? "This launch tier is sold out."
                              : "Lock in founding $29.99/month pricing."
                          }
                          onClick={() => earlyBirdActive && !earlyBirdSoldOut && handleCheckout("early_bird")}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

            </section>

            {/* Comparison hint */}
            <p className="text-[11px] text-center text-slate-500 mb-3">
              Want to see everything side by side? Switch to{" "}
              <span className="font-semibold text-slate-200">Comparison View</span> above.
            </p>
          </>
        ) : (
          <>
            {/* Comparison table */}
            <section className="mt-8 mb-10 rounded-3xl border border-slate-800/80 bg-slate-950/80 shadow-[0_0_40px_rgba(15,23,42,0.9)] overflow-hidden">
              <div className="grid grid-cols-[1.3fr,1fr,1fr] text-xs md:text-sm">
                {/* Header row */}
                <div className="border-b border-slate-800/80 bg-slate-950/90 px-4 py-3 flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Feature</span>
                </div>
                <div className="border-b border-slate-800/80 bg-gradient-to-br from-purple-900/90 via-purple-950/90 to-slate-950/90 px-4 py-3 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-purple-200/80">OG Eternal Throne</span>
                  <span className="text-xs font-semibold text-purple-50">$1,333 one-time</span>
                  <span className="text-[10px] text-purple-200/80">50 total seats • Lifetime</span>
                </div>
                <div className="border-b border-slate-800/80 bg-gradient-to-br from-pink-900/90 via-pink-950/90 to-slate-950/90 px-4 py-3 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-pink-200/80">Early Bird</span>
                  <span className="text-xs font-semibold text-pink-50">$29.99/month</span>
                  <span className="text-[10px] text-pink-200/80">150 total seats</span>
                </div>


                {/* Rows */}
                {compareRows.map((row, idx) => (
                  <div
                    key={row.label}
                    className={`contents ${idx % 2 === 0 ? "bg-slate-950/80" : "bg-slate-950/60"}`}
                  >
                    {/* Label */}
                    <div className="border-t border-slate-800/80 px-4 py-3 flex items-center">
                      <span className="font-medium text-slate-100">{row.label}</span>
                    </div>

                    {/* OG */}
                    <CompareCell highlight={row.highlight === "og"} value={row.og} />

                    {/* Early Bird */}
                    <CompareCell highlight={row.highlight === "earlybird"} value={row.earlyBird} />

                  </div>
                ))}
              </div>
            </section>

            <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch md:items-center justify-between">
              <div className="text-xs text-slate-400 max-w-2xl">
                <p className="mb-2 font-semibold text-slate-100">How to choose your tier:</p>
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>
                    If you want the highest founder referral commissions, lifetime founder access, and permanent OG Founder
                    recognition, OG Eternal Throne is designed for you.
                  </li>
                  <li>
                    If you want <span className="font-semibold">flexibility</span> with strong commissions and full access, Early Bird is
                    the best monthly option.
                  </li>

                </ul>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 md:gap-4 w-full md:w-auto">
                <NeonButton
                  disabled={!canCheckout || !ogActive || ogSoldOut}
                  loading={checkoutLoading === "og_throne"}
                  label={!availabilityLoaded ? "Loading availability…" : ogUnavailable ? "Currently unavailable" : ogSoldOut ? "OG Sold Out • View Early Bird" : "Claim OG Eternal Throne"}
                  sublabel={
                    !availabilityLoaded
                      ? "Seat counter is syncing…"
                      : ogUnavailable
                      ? "This launch tier is inactive."
                      : ogSoldOut
                      ? "OG seats are gone. Early Bird is now the top tier."
                      : "Lifetime elite access • Highest commissions"
                  }
                  onClick={() => ogActive && !ogSoldOut && handleCheckout("og_throne")}
                />
                <NeonButton
                  disabled={!canCheckout || !earlyBirdActive || earlyBirdSoldOut}
                  loading={checkoutLoading === "early_bird"}
                  label={!availabilityLoaded ? "Loading availability…" : earlyBirdUnavailable ? "Currently unavailable" : earlyBirdSoldOut ? "Early Bird Sold Out" : "Join Early Bird"}
                  sublabel={
                    !availabilityLoaded
                      ? "Seat counter is syncing…"
                      : earlyBirdUnavailable
                      ? "This launch tier is inactive."
                      : earlyBirdSoldOut
                      ? "This launch tier is sold out."
                      : "Founding monthly rate • Limited seats"
                  }
                  onClick={() => earlyBirdActive && !earlyBirdSoldOut && handleCheckout("early_bird")}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function AnimatedBadge({ label, className = "" }: { label: string; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={`absolute z-20 rounded-full bg-slate-950/95 border border-slate-700/80 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase flex items-center gap-1.5 shadow-[0_0_20px_rgba(15,23,42,0.9)] ${className}`}
    >
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
      <span className="text-slate-100">{label}</span>
    </motion.div>
  );
}

function AnimatedGlow({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute -inset-x-10 -top-32 h-36 blur-3xl opacity-40 ${className}`}
    />
  );
}

function CompareCell({ value, highlight }: { value: string; highlight?: boolean }) {
  return (
    <div
      className={`border-t border-slate-800/80 px-4 py-3 text-xs md:text-sm flex items-center ${
        highlight
          ? "bg-gradient-to-r from-slate-900/80 via-slate-900/90 to-slate-900/80 text-slate-50 font-medium"
          : "text-slate-300"
      }`}
    >
      <div className="flex items-start gap-1.5">
        {highlight && <Check className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />}
        <span>{value}</span>
      </div>
    </div>
  );
}

function NeonButton({
  label,
  sublabel,
  onClick,
  disabled,
  loading,
}: {
  label: string;
  sublabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      className={`relative inline-flex flex-col items-center justify-center px-5 py-2.5 rounded-full text-xs md:text-sm font-semibold tracking-wide ${
        disabled
          ? "bg-slate-800 text-slate-500 cursor-not-allowed"
          : "bg-slate-50 text-slate-900 hover:bg-white shadow-[0_0_25px_rgba(148,163,184,0.9)]"
      } transition-all`}
      onClick={onClick}
      disabled={disabled}
    >
      {!disabled && !loading && (
        <motion.div aria-hidden className="pointer-events-none absolute -inset-1 opacity-70">
          <motion.div
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
            initial={{ x: "-120%" }}
            animate={{ x: ["-120%", "140%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      )}
      <span className="relative z-10">{loading ? "Redirecting to Stripe…" : label}</span>
      {sublabel && <span className="relative z-10 text-[10px] text-slate-600 mt-0.5">{sublabel}</span>}
    </button>
  );
}
