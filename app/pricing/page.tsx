"use client";

import { useEffect, useState } from "react";
import { motion, animate } from "framer-motion";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Crown, Star, Sparkles, AlertTriangle, Check } from "lucide-react";

type ViewMode = "cards" | "compare";
type CheckoutTier = "og_throne" | "early_bird";

interface TierSeats {
  remaining: number;
  total: number;
}

interface SeatState {
  og: TierSeats;
  earlyBird: TierSeats;
}

const FALLBACK_SEATS: SeatState = {
  og: { remaining: 10, total: 35 },
  earlyBird: { remaining: 120, total: 150 }, // updated totals (Early Bird max = 150)
};

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
    prime_access?: SeatCountTier;
    [key: string]: SeatCountTier | undefined;
  };
}

// Small helper to animate numeric transitions (seat counters)
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState<number>(value);

  useEffect(() => {
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

export default function PricingPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [seats, setSeats] = useState<SeatState>(FALLBACK_SEATS);
  const [loadingSeats, setLoadingSeats] = useState<boolean>(false);

  const [checkoutLoading, setCheckoutLoading] = useState<CheckoutTier | null>(
    null
  );
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const ogSoldOut = seats.og.remaining <= 0;
  const earlyBirdSoldOut = seats.earlyBird.remaining <= 0;

  // Live seat polling – wired to /api/subscription/seat-count
  useEffect(() => {
    let active = true;

    const fetchSeats = async () => {
      try {
        setLoadingSeats(true);
        const res = await fetch("/api/subscription/seat-count", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Seat endpoint not ready");

        const data = (await res.json()) as SeatCountApiResponse;

        if (!active || !data?.tiers) return;

        const ogTier = data.tiers.og_throne;
        const ebTier = data.tiers.early_bird;

        setSeats((prev) => ({
          og: {
            remaining: ogTier?.slots_remaining ?? prev.og.remaining,
            total: ogTier?.max_slots ?? prev.og.total,
          },
          earlyBird: {
            remaining: ebTier?.slots_remaining ?? prev.earlyBird.remaining,
            total: ebTier?.max_slots ?? prev.earlyBird.total,
          },
        }));
      } catch {
        // Silently fall back to hard-coded counts
      } finally {
        if (active) setLoadingSeats(false);
      }
    };

    fetchSeats();

    const interval = setInterval(fetchSeats, 15_000); // poll every 15s
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleCheckout = async (tierName: CheckoutTier) => {
    try {
      setCheckoutError(null);
      setCheckoutLoading(tierName);

      const res = await fetch("/api/checkout/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // PRICING PAGE IS PUBLIC (NO AUTH). Stripe Checkout happens first.
        body: JSON.stringify({
          tierName,
        }),
      });

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const msg =
          json?.error ||
          (res.status === 409
            ? "That tier is sold out."
            : "Checkout failed. Please try again.");
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

  const seatText = (tier: TierSeats) =>
    `${tier.remaining}/${tier.total} seats left`;

  const compareRows: {
    label: string;
    og: string;
    earlyBird: string;
    prime?: string;
    highlight?: "og" | "earlybird" | "prime";
  }[] = [
    {
      label: "Pricing",
      og: "$1,333 one-time",
      earlyBird: "$29.99/month",
      prime: "$59.99/month",
      highlight: "earlybird",
    },
    {
      label: "Availability",
      og: "35 total seats",
      earlyBird: "150 total seats",
      prime: "250 total seats",
      highlight: "og",
    },
    {
      label: "Affiliate % (first 6 months)",
      og: "50%",
      earlyBird: "20%",
      prime: "10%",
      highlight: "og",
    },
    {
      label: "Affiliate % (lifetime after 6 months)",
      og: "25%",
      earlyBird: "10%",
      prime: "7.5%",
      highlight: "og",
    },
    {
      label: "Founding Recognition",
      og: "OG Eternal Throne badge, top placement",
      earlyBird: "Founding circle badge",
      prime: "Early supporter badge",
      highlight: "og",
    },
    {
      label: "Token Boosts & Rewards",
      og: "Highest bonus multipliers and early beta access",
      earlyBird: "Strong boosts and beta access",
      prime: "Standard boosts after launch",
      highlight: "og",
    },
    {
      label: "Best For",
      og: "Creators serious about scaling and building an empire",
      earlyBird: "Creators ready to go all-in at a flexible monthly rate",
      prime: "Creators entering after launch at higher pricing",
      highlight: "earlybird",
    },
  ];

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
              Lock in OG or Early Bird benefits before public pricing activates.
              Seats update in real time as founders join.
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
          <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 md:px-5 md:py-3.5 shadow-[0_0_35px_rgba(15,23,42,0.9)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                <p className="font-semibold text-slate-50">
                  Live Founder Seat Tracking
                </p>
                <p className="text-slate-400">
                  OG and Early Bird seat counters sync directly with the
                  database. Numbers update as soon as a tier is claimed.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start sm:items-end text-[11px] md:text-xs text-slate-400 gap-1.5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                  <span>OG: </span>
                  <span className="font-semibold text-slate-100">
                    {ogSoldOut ? (
                      <span className="text-amber-300">SOLD OUT</span>
                    ) : (
                      <AnimatedNumber value={seats.og.remaining} />
                    )}
                    <span className="mx-0.5">/</span>
                    <AnimatedNumber value={seats.og.total} />
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-pink-400 animate-pulse shadow-[0_0_12px_rgba(244,114,182,0.8)]" />
                  <span>Early Bird: </span>
                  <span className="font-semibold text-slate-100">
                    {earlyBirdSoldOut ? (
                      <span className="text-amber-300">SOLD OUT</span>
                    ) : (
                      <AnimatedNumber value={seats.earlyBird.remaining} />
                    )}
                    <span className="mx-0.5">/</span>
                    <AnimatedNumber value={seats.earlyBird.total} />
                  </span>
                </div>
              </div>
              {loadingSeats && (
                <p className="text-[10px] text-slate-500">
                  Syncing with live seat data…
                </p>
              )}
            </div>
          </div>
        </motion.section>

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
            <section className="grid gap-6 md:gap-8 md:grid-cols-2 lg:grid-cols-3 items-stretch mb-10">
              {/* OG THRONE */}
              <motion.div
                initial={{ opacity: 0, y: 25, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                whileHover={{
                  y: -8,
                  scale: 1.02,
                  rotateX: -1.5,
                  rotateY: -1.5,
                }}
                className="transform-gpu"
              >
                <Card className="relative h-full border border-purple-600/70 bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-950/90 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(168,85,247,0.45)]">
                  <AnimatedBadge label="Lifetime Elite" className="left-4 top-4" />
                  <AnimatedGlow className="bg-purple-500/40" />

                  {/* Selling fast micro banner when <= 10 and > 0 */}
                  {seats.og.remaining > 0 && seats.og.remaining <= 10 && (
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
                        <CardTitle className="text-xl font-bold text-white">
                          Founding Empire Tier
                        </CardTitle>
                      </div>
                    </div>

                    <CardDescription className="text-sm text-gray-300/95 text-center max-w-xs mx-auto">
                      Own a <span className="font-semibold">lifetime</span>{" "}
                      stake in SirensForge. Highest commissions, deepest
                      recognition, and top-tier leverage forever.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-6 pb-6">
                    <ul className="space-y-2.5 text-gray-200 text-sm">
                      <li>
                        • <strong>50% commission</strong> on subscription
                        referrals (first 6 months)
                      </li>
                      <li>
                        • <strong>25% lifetime commission</strong> on
                        subscriptions after 6 months
                      </li>
                      <li>
                        • Highest priority in feature voting and early beta
                        access
                      </li>
                      <li>• Lifetime OG badge and top-tier platform status</li>
                      <li>
                        • Locked-in <strong>lifetime deal</strong> — pay once,
                        never again.
                      </li>
                    </ul>

                    <div className="space-y-3">
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <div className="text-3xl font-black tracking-tight">
                          $1,333
                        </div>
                        <div className="text-gray-400 text-xs uppercase tracking-[0.25em]">
                          One-time • Lifetime
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-1.5 text-xs text-gray-300">
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/90 border border-purple-500/70 px-3 py-1 shadow-[0_0_25px_rgba(168,85,247,0.9)]">
                          {ogSoldOut ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span className="font-semibold text-amber-200">
                                SOLD OUT
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                              <span className="font-semibold text-amber-100">
                                <span className="uppercase tracking-[0.18em] text-[9px] mr-1">
                                  OG Seats
                                </span>
                                {seatText(seats.og)}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="block text-xs text-gray-400 max-w-xs mx-auto">
                          Secure one of the final OG Founder slots and lock in
                          elite affiliate benefits for life.
                        </span>
                      </div>

                      <NeonButton
                        disabled={ogSoldOut || checkoutLoading !== null}
                        loading={checkoutLoading === "og_throne"}
                        label={ogSoldOut ? "OG Seats Sold Out" : "Claim OG Throne"}
                        sublabel={
                          ogSoldOut
                            ? "Join Early Bird below instead."
                            : "Lifetime elite access • No recurring payment"
                        }
                        onClick={() => !ogSoldOut && handleCheckout("og_throne")}
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
                whileHover={{
                  y: -8,
                  scale: 1.02,
                  rotateX: 1.5,
                  rotateY: 1.5,
                }}
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
                        <p className="text-[11px] uppercase tracking-[0.25em] text-pink-100/80">
                          Early Bird Access
                        </p>
                        <CardTitle className="text-xl font-bold text-white">
                          Founding Monthly Tier
                        </CardTitle>
                      </div>
                    </div>

                    <CardDescription className="text-sm text-gray-300/95 text-center max-w-xs mx-auto">
                      Lock in a{" "}
                      <span className="font-semibold">$29.99</span> monthly
                      rate before prices rise. Strong commissions, full access,
                      and founder recognition baked in.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-6 pb-6">
                    <ul className="space-y-2.5 text-gray-200 text-sm">
                      <li>
                        • Affiliate: <strong>20%</strong> first 6 months,{" "}
                        <strong>10% lifetime</strong>
                      </li>
                      <li>• 10% commission on one-time purchases</li>
                      <li>• Crowned forever in platform</li>
                    </ul>

                    <div className="space-y-3">
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <div className="text-4xl font-extrabold tracking-tight">
                          $29.99
                        </div>
                        <div className="text-gray-400 text-xs uppercase tracking-[0.25em]">
                          Per month
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-1.5 text-xs text-gray-300">
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/90 border border-pink-500/70 px-3 py-1 shadow-[0_0_25px_rgba(236,72,153,0.9)]">
                          {earlyBirdSoldOut ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span className="font-semibold text-amber-200">
                                SOLD OUT
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-pink-300 animate-pulse" />
                              <span className="font-semibold text-pink-100">
                                <span className="uppercase tracking-[0.18em] text-[9px] mr-1">
                                  Early Bird
                                </span>
                                {seatText(seats.earlyBird)}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="block text-xs text-gray-400 max-w-xs mx-auto">
                          Once Early Bird sells out, pricing moves to Prime and
                          then Standard. This is the{" "}
                          <span className="font-semibold">sweet spot</span> for
                          most creators.
                        </span>
                      </div>

                      <NeonButton
                        disabled={earlyBirdSoldOut || checkoutLoading !== null}
                        loading={checkoutLoading === "early_bird"}
                        label={
                          earlyBirdSoldOut ? "Early Bird Sold Out" : "Join Early Bird"
                        }
                        sublabel={
                          earlyBirdSoldOut
                            ? "Prime & Standard will open next."
                            : "Lock in founding $29.99/month pricing."
                        }
                        onClick={() =>
                          !earlyBirdSoldOut && handleCheckout("early_bird")
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* PRIME & FUTURE */}
              <motion.div
                initial={{ opacity: 0, y: 25, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.15, duration: 0.7, ease: "easeOut" }}
                className="transform-gpu"
              >
                <Card className="relative h-full border border-slate-700/80 bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-950/90 rounded-3xl overflow-hidden shadow-[0_0_30px_rgba(15,23,42,0.85)]">
                  <AnimatedGlow className="bg-cyan-500/25" />

                  <CardHeader className="pt-12">
                    <div className="flex items-center justify-center gap-3 mb-3">
                      <div className="relative">
                        <div className="absolute inset-0 blur-md bg-cyan-500/45" />
                        <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-cyan-300 shadow-[0_0_24px_rgba(6,182,212,0.9)]">
                          <Sparkles className="w-5 h-5 text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.95)]" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] uppercase tracking-[0.25em] text-cyan-100/80">
                          Future Tiers
                        </p>
                        <CardTitle className="text-xl font-bold text-white">
                          Prime & Standard (Coming Soon)
                        </CardTitle>
                      </div>
                    </div>

                    <CardDescription className="text-sm text-gray-300/95 text-center max-w-xs mx-auto">
                      These tiers open once OG and Early Bird fill. Pricing will
                      never be this low again.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-6 pb-6">
                    <div className="space-y-4 text-sm text-gray-200">
                      <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold">Prime</span>
                          <span className="text-lg font-bold">$59.99/mo</span>
                        </div>
                        <p className="text-xs text-gray-400">250 total seats</p>
                        <p className="text-[11px] mt-1 text-gray-500">
                          10% commission (6 months) • 7.5% lifetime after
                          launch. Reserved for creators who join once Early Bird
                          is full.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-300" />
                          <span className="text-xs font-semibold text-amber-100 tracking-[0.12em] uppercase">
                            Why early tiers matter
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          Early tiers lock in better commissions, higher
                          visibility, and stronger influence over the roadmap.
                          Once we move to Prime and Standard, the economics
                          shift in favor of the platform instead of just early
                          adopters.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                        <p className="text-xs font-semibold text-slate-100">
                          Standard Subscription (Post-Launch)
                        </p>
                        <p className="text-[11px] text-gray-400 mt-1">
                          Standard users will pay higher rates with lower
                          commission and fewer perks. OG and Early Bird are{" "}
                          <span className="font-semibold">
                            intentionally overpowered
                          </span>{" "}
                          to reward the first wave of believers.
                        </p>
                      </div>
                    </div>

                    <div className="pt-1 text-[11px] text-gray-500 text-center">
                      Prime & Standard will open automatically once Early Bird
                      seats reach capacity.
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </section>

            {/* Comparison hint */}
            <p className="text-[11px] text-center text-slate-500 mb-3">
              Want to see everything side by side? Switch to{" "}
              <span className="font-semibold text-slate-200">
                Comparison View
              </span>{" "}
              above.
            </p>
          </>
        ) : (
          <>
            {/* Comparison table */}
            <section className="mt-8 mb-10 rounded-3xl border border-slate-800/80 bg-slate-950/80 shadow-[0_0_40px_rgba(15,23,42,0.9)] overflow-hidden">
              <div className="grid grid-cols-[1.3fr,1fr,1fr,1fr] text-xs md:text-sm">
                {/* Header row */}
                <div className="border-b border-slate-800/80 bg-slate-950/90 px-4 py-3 flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
                    Feature
                  </span>
                </div>
                <div className="border-b border-slate-800/80 bg-gradient-to-br from-purple-900/90 via-purple-950/90 to-slate-950/90 px-4 py-3 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-purple-200/80">
                    OG Eternal Throne
                  </span>
                  <span className="text-xs font-semibold text-purple-50">
                    $1,333 one-time
                  </span>
                  <span className="text-[10px] text-purple-200/80">
                    35 total seats • Lifetime
                  </span>
                </div>
                <div className="border-b border-slate-800/80 bg-gradient-to-br from-pink-900/90 via-pink-950/90 to-slate-950/90 px-4 py-3 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-pink-200/80">
                    Early Bird
                  </span>
                  <span className="text-xs font-semibold text-pink-50">
                    $29.99/month
                  </span>
                  <span className="text-[10px] text-pink-200/80">
                    150 total seats
                  </span>
                </div>
                <div className="border-b border-slate-800/80 bg-gradient-to-br from-cyan-900/80 via-slate-950/90 to-slate-950/90 px-4 py-3 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-cyan-200/80">
                    Prime (Coming Soon)
                  </span>
                  <span className="text-xs font-semibold text-cyan-50">
                    $59.99/month
                  </span>
                  <span className="text-[10px] text-cyan-200/80">
                    250 total seats
                  </span>
                </div>

                {/* Rows */}
                {compareRows.map((row, idx) => (
                  <div
                    key={row.label}
                    className={`contents ${
                      idx % 2 === 0 ? "bg-slate-950/80" : "bg-slate-950/60"
                    }`}
                  >
                    {/* Label */}
                    <div className="border-t border-slate-800/80 px-4 py-3 flex items-center">
                      <span className="font-medium text-slate-100">
                        {row.label}
                      </span>
                    </div>

                    {/* OG */}
                    <CompareCell
                      highlight={row.highlight === "og"}
                      value={row.og}
                    />

                    {/* Early Bird */}
                    <CompareCell
                      highlight={row.highlight === "earlybird"}
                      value={row.earlyBird}
                    />

                    {/* Prime */}
                    <CompareCell
                      highlight={row.highlight === "prime"}
                      value={row.prime ?? "Opens after Early Bird fills"}
                    />
                  </div>
                ))}
              </div>
            </section>

            <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch md:items-center justify-between">
              <div className="text-xs text-slate-400 max-w-2xl">
                <p className="mb-2 font-semibold text-slate-100">
                  How to choose your tier:
                </p>
                <ul className="space-y-1.5 list-disc list-inside">
                  <li>
                    If you want <span className="font-semibold">maximum</span>{" "}
                    upside, lifetime perks, and top platform visibility, OG
                    Eternal Throne is designed for you.
                  </li>
                  <li>
                    If you want{" "}
                    <span className="font-semibold">flexibility</span> with
                    strong commissions and full access, Early Bird is the best
                    monthly option.
                  </li>
                  <li>
                    If you plan to join{" "}
                    <span className="font-semibold">after</span> launch,
                    you&apos;ll likely end up in Prime or Standard at higher
                    pricing and lower upside.
                  </li>
                </ul>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 md:gap-4 w-full md:w-auto">
                <NeonButton
                  disabled={ogSoldOut || checkoutLoading !== null}
                  loading={checkoutLoading === "og_throne"}
                  label={
                    ogSoldOut
                      ? "OG Sold Out • View Early Bird"
                      : "Claim OG Eternal Throne"
                  }
                  sublabel={
                    ogSoldOut
                      ? "OG seats are gone. Early Bird is now the top tier."
                      : "Lifetime elite access • Highest commissions"
                  }
                  onClick={() => !ogSoldOut && handleCheckout("og_throne")}
                />
                <NeonButton
                  disabled={earlyBirdSoldOut || checkoutLoading !== null}
                  loading={checkoutLoading === "early_bird"}
                  label={earlyBirdSoldOut ? "Early Bird Sold Out" : "Join Early Bird"}
                  sublabel={
                    earlyBirdSoldOut
                      ? "Prime & Standard will open next."
                      : "Founding monthly rate • Limited seats"
                  }
                  onClick={() => !earlyBirdSoldOut && handleCheckout("early_bird")}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function AnimatedBadge({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
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

function CompareCell({
  value,
  highlight,
}: {
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`border-t border-slate-800/80 px-4 py-3 text-xs md:text-sm flex items-center ${
        highlight
          ? "bg-gradient-to-r from-slate-900/80 via-slate-900/90 to-slate-900/80 text-slate-50 font-medium"
          : "text-slate-300"
      }`}
    >
      <div className="flex items-start gap-1.5">
        {highlight && (
          <Check className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />
        )}
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
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-1 opacity-70"
        >
          <motion.div
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
            initial={{ x: "-120%" }}
            animate={{ x: ["-120%", "140%"] }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        </motion.div>
      )}
      <span className="relative z-10">
        {loading ? "Redirecting to Stripe…" : label}
      </span>
      {sublabel && (
        <span className="relative z-10 text-[10px] text-slate-600 mt-0.5">
          {sublabel}
        </span>
      )}
    </button>
  );
}
