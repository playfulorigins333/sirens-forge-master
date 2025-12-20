import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // Cast as any so TS doesn't care about the literal version value
  apiVersion: "2025-11-17.clover" as any,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findProfileIdByStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  if (!stripeCustomerId) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) {
    console.error(
      "❌ Supabase error finding profile by stripe_customer_id:",
      error
    );
    return null;
  }

  return data?.id ?? null;
}

async function findTierByPriceId(priceId: string | null | undefined) {
  if (!priceId) return null;

  const { data, error } = await supabaseAdmin
    .from("subscription_tiers")
    .select("id, name, display_name, stripe_price_id")
    .eq("stripe_price_id", priceId)
    .maybeSingle();

  if (error) {
    console.error(
      "❌ Supabase error finding subscription_tiers by priceId:",
      error
    );
    return null;
  }

  return data ?? null;
}

/**
 * 🔁 Commission ledger helpers
 *
 * We lock commission in affiliate_ledger on Stripe-confirmed checkout completion,
 * when a referral_code is present in session.metadata.
 *
 * NOTE:
 * Your referral_codes table stores { email, code } (no user_id), so we map:
 * referral_codes.code -> referral_codes.email -> profiles.id (affiliate_user_id)
 */
async function findAffiliateUserIdByReferralCode(
  code: string | null | undefined
): Promise<string | null> {
  if (!code) return null;

  const { data: rc, error: rcErr } = await supabaseAdmin
    .from("referral_codes")
    .select("email, is_active")
    .eq("code", code)
    .maybeSingle();

  if (rcErr) {
    console.error("❌ Supabase error finding referral_codes by code:", rcErr);
    return null;
  }
  if (!rc?.email || rc?.is_active !== true) return null;

  const { data: prof, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", rc.email)
    .maybeSingle();

  if (profErr) {
    console.error("❌ Supabase error finding profile by referral email:", profErr);
    return null;
  }

  return prof?.id ?? null;
}

async function ledgerEntryExists(stripeEventId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("affiliate_ledger")
    .select("id")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();

  if (error) {
    // If the table exists but query fails for some reason, do NOT block checkout.
    console.error("❌ Supabase error checking affiliate_ledger existence:", error);
    return false;
  }
  return Boolean(data?.id);
}

function safeInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.floor(x) : fallback;
}

function computeCommissionCents(grossAmountCents: number, percent: number) {
  if (grossAmountCents <= 0 || percent <= 0) return 0;
  return Math.floor((grossAmountCents * percent) / 100);
}

/**
 * Commission percent source of truth (launch-safe default):
 * - OG: 50% (first 6 months) -- your OG promise
 * - Early Bird: 20% (first 6 months)
 * - Prime: 10% (first 6 months)
 *
 * If later you add subscription_tiers.affiliate_percent, we can switch to DB.
 */
function getLaunchCommissionPercent(tierName: string | null | undefined): number {
  if (!tierName) return 0;

  if (tierName === "og_throne") return 50;
  if (tierName === "early_bird") return 20;
  if (tierName === "prime_access") return 10;

  return 0;
}

async function insertAffiliateLedgerEntry({
  affiliateUserId,
  referredUserId,
  stripeEventId,
  stripeSubscriptionId,
  tierName,
  grossAmountCents,
  commissionPercent,
}: {
  affiliateUserId: string;
  referredUserId: string;
  stripeEventId: string;
  stripeSubscriptionId: string | null;
  tierName: string;
  grossAmountCents: number;
  commissionPercent: number;
}) {
  // Idempotency guard by stripe_event_id
  const exists = await ledgerEntryExists(stripeEventId);
  if (exists) {
    console.log("ℹ️ affiliate_ledger already recorded for event:", stripeEventId);
    return;
  }

  const commissionAmountCents = computeCommissionCents(
    grossAmountCents,
    commissionPercent
  );

  if (commissionAmountCents <= 0) {
    console.log("ℹ️ Commission computed as $0; skipping ledger insert.");
    return;
  }

  const { error } = await supabaseAdmin.from("affiliate_ledger").insert({
    affiliate_user_id: affiliateUserId,
    referred_user_id: referredUserId,
    stripe_event_id: stripeEventId,
    stripe_subscription_id: stripeSubscriptionId,
    tier_name: tierName,
    gross_amount_cents: grossAmountCents,
    commission_percent: commissionPercent,
    commission_amount_cents: commissionAmountCents,
    status: "pending",
  });

  if (error) {
    console.error("❌ Failed to insert affiliate ledger entry:", error);
  } else {
    console.log("💰 Affiliate commission locked in ledger:", {
      stripeEventId,
      affiliateUserId,
      referredUserId,
      commissionPercent,
      commissionAmountCents,
    });
  }
}

async function upsertUserSubscriptionFromStripe(sub: any) {
  const stripeCustomerId = String(sub.customer);
  const stripeSubscriptionId = sub.id;

  const profileId = await findProfileIdByStripeCustomer(stripeCustomerId);
  if (!profileId) {
    console.warn(
      "⚠️ No profile found for stripe_customer_id, skipping user_subscriptions upsert:",
      stripeCustomerId
    );
    return;
  }

  const firstItem = sub.items?.data?.[0];
  const priceId = firstItem?.price?.id ?? null;

  const tier = await findTierByPriceId(priceId);
  if (!tier) {
    console.warn(
      "⚠️ No subscription_tier found for priceId, skipping user_subscriptions upsert:",
      priceId
    );
    return;
  }

  const currentPeriodStart = sub.current_period_start
    ? new Date(sub.current_period_start * 1000).toISOString()
    : null;

  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const trialStart = sub.trial_start
    ? new Date(sub.trial_start * 1000).toISOString()
    : null;

  const trialEnd = sub.trial_end
    ? new Date(sub.trial_end * 1000).toISOString()
    : null;

  const status: string = sub.status ?? "active";
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const canceledAt = sub.canceled_at
    ? new Date(sub.canceled_at * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from("user_subscriptions").upsert(
    {
      user_id: profileId,
      tier_id: tier.id,
      tier_name: tier.display_name ?? tier.name,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      status,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      canceled_at: canceledAt,
      trial_start: trialStart,
      trial_end: trialEnd,
      metadata: {
        stripe_price_id: priceId,
        stripe_plan_id: firstItem?.plan?.id ?? null,
      },
    },
    {
      onConflict: "stripe_subscription_id",
    }
  );

  if (error) {
    console.error("❌ Supabase error upserting user_subscriptions:", error);
  } else {
    console.log(
      "✅ user_subscriptions upserted for subscription:",
      stripeSubscriptionId
    );
  }
}

async function updateSubscriptionStatusFromInvoice(invoice: any) {
  const stripeSubscriptionId = String(invoice.subscription ?? "");
  const stripeCustomerId = String(invoice.customer ?? "");

  if (!stripeSubscriptionId || !stripeCustomerId) {
    console.warn(
      "⚠️ Invoice missing subscription or customer, skipping status update."
    );
    return;
  }

  const profileId = await findProfileIdByStripeCustomer(stripeCustomerId);
  if (!profileId) {
    console.warn(
      "⚠️ No profile found for stripe_customer_id from invoice:",
      stripeCustomerId
    );
    return;
  }

  const paid: boolean = Boolean(invoice.paid);
  const status = paid ? "active" : "past_due";

  const { error } = await supabaseAdmin
    .from("user_subscriptions")
    .update({
      status,
    })
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .eq("user_id", profileId);

  if (error) {
    console.error(
      "❌ Supabase error updating user_subscriptions from invoice:",
      error
    );
  } else {
    console.log(
      `✅ user_subscriptions status updated from invoice: ${stripeSubscriptionId} → ${status}`
    );
  }
}

async function cancelUserSubscription(stripeSubscriptionId: string) {
  const { error } = await supabaseAdmin
    .from("user_subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      cancel_at_period_end: true,
    })
    .eq("stripe_subscription_id", stripeSubscriptionId);

  if (error) {
    console.error("❌ Supabase error canceling user_subscriptions:", error);
  } else {
    console.log(
      "✅ user_subscriptions status set to canceled for:",
      stripeSubscriptionId
    );
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const payload = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Invalid Stripe Signature:", err.message);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  console.log("🔔 Stripe Event:", event.type, "ID:", event.id);

  try {
    switch (event.type) {
      case "customer.subscription.created": {
        const sub: any = event.data.object as any;
        await upsertUserSubscriptionFromStripe(sub);
        break;
      }

      case "customer.subscription.updated": {
        const sub: any = event.data.object as any;
        await upsertUserSubscriptionFromStripe(sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub: any = event.data.object as any;
        await cancelUserSubscription(sub.id);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice: any = event.data.object as any;
        await updateSubscriptionStatusFromInvoice(invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice: any = event.data.object as any;
        await updateSubscriptionStatusFromInvoice(invoice);
        break;
      }

      case "checkout.session.completed": {
        const session: any = event.data.object as any;

        // Subscription checkout → retrieve subscription and upsert
        if (session.mode === "subscription" && session.subscription) {
          const sub: any = await stripe.subscriptions.retrieve(
            String(session.subscription)
          );

          await upsertUserSubscriptionFromStripe(sub);

          // 💰 Commission lock (if referral_code present)
          // Expecting (optional) metadata:
          // - referral_code
          // - tier_name
          // - user_id (may be missing if checkout is pre-auth; we fall back to profileId)
          const referralCode: string | null = session.metadata?.referral_code ?? null;
          const tierName: string | null = session.metadata?.tier_name ?? null;

          // Determine the "buyer" as a profile id via customer mapping (authoritative)
          const stripeCustomerId = String(session.customer ?? "");
          const referredProfileId = await findProfileIdByStripeCustomer(stripeCustomerId);

          if (referralCode && referredProfileId && tierName) {
            const affiliateUserId = await findAffiliateUserIdByReferralCode(referralCode);

            // Avoid self-referral
            if (affiliateUserId && affiliateUserId !== referredProfileId) {
              // Prefer amount_total if present; otherwise compute from line_items if expanded.
              let grossAmountCents = safeInt(session.amount_total, 0);

              if (!grossAmountCents) {
                // Best-effort compute by retrieving expanded line items
                try {
                  const full = await stripe.checkout.sessions.retrieve(String(session.id), {
                    expand: ["line_items.data.price"],
                  });

                  const li = full.line_items?.data?.[0] as any;
                  const qty = safeInt(li?.quantity, 1);
                  const unit = safeInt(li?.price?.unit_amount, 0);
                  grossAmountCents = qty * unit;
                } catch (e) {
                  // do nothing; leave as 0
                }
              }

              const commissionPercent = getLaunchCommissionPercent(tierName);

              if (grossAmountCents > 0 && commissionPercent > 0) {
                await insertAffiliateLedgerEntry({
                  affiliateUserId,
                  referredUserId: referredProfileId,
                  stripeEventId: event.id,
                  stripeSubscriptionId: String(sub.id ?? ""),
                  tierName,
                  grossAmountCents,
                  commissionPercent,
                });
              }
            }
          }

          break;
        }

        // One-time checkout (OG Eternal Throne) → upsert "lifetime" row
        if (session.mode === "payment") {
          const stripeCustomerId = String(session.customer ?? "");
          const checkoutSessionId = String(session.id ?? "");

          if (!stripeCustomerId) {
            console.warn(
              "⚠️ checkout.session.completed (payment) missing customer id; cannot grant OG access."
            );
            break;
          }

          // Load line items so we can read the price id that was purchased
          const full = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
            expand: ["line_items.data.price"],
          });

          const firstItem = full.line_items?.data?.[0] as any;
          const priceId: string | null = firstItem?.price?.id ?? null;

          const profileId = await findProfileIdByStripeCustomer(stripeCustomerId);
          if (!profileId) {
            console.warn(
              "⚠️ No profile found for stripe_customer_id (payment); cannot grant OG access:",
              stripeCustomerId
            );
            break;
          }

          const tier = await findTierByPriceId(priceId);
          if (!tier) {
            console.warn(
              "⚠️ No subscription_tier found for priceId (payment); cannot grant OG access:",
              priceId
            );
            break;
          }

          // Use a stable unique key so this upsert is idempotent.
          // This DOES NOT represent a Stripe subscription; it is a one-time purchase record stored in user_subscriptions.
          const pseudoSubscriptionId = `og_${checkoutSessionId}`;

          const { error } = await supabaseAdmin
            .from("user_subscriptions")
            .upsert(
              {
                user_id: profileId,
                tier_id: tier.id,
                tier_name: tier.display_name ?? tier.name,
                stripe_subscription_id: pseudoSubscriptionId,
                stripe_customer_id: stripeCustomerId,
                status: "active",
                current_period_start: new Date().toISOString(),
                current_period_end: null,
                cancel_at_period_end: false,
                canceled_at: null,
                trial_start: null,
                trial_end: null,
                metadata: {
                  stripe_price_id: priceId,
                  checkout_session_id: checkoutSessionId,
                  mode: "payment",
                  type: "one_time",
                  counts_toward_seats: true,
                },
              },
              { onConflict: "stripe_subscription_id" }
            );

          if (error) {
            console.error("❌ Supabase error upserting OG one-time access:", error);
          } else {
            console.log("✅ OG one-time access granted via checkout session:", checkoutSessionId);
          }

          // 💰 Commission lock (if referral_code present) for one-time OG
          const referralCode: string | null = session.metadata?.referral_code ?? null;

          if (referralCode) {
            const affiliateUserId = await findAffiliateUserIdByReferralCode(referralCode);

            // Avoid self-referral
            if (affiliateUserId && affiliateUserId !== profileId) {
              const qty = safeInt(firstItem?.quantity, 1);
              const unit = safeInt(firstItem?.price?.unit_amount, 0);
              const grossAmountCents = qty * unit;

              const tierName = tier.name; // canonical internal tier name
              const commissionPercent = getLaunchCommissionPercent(tierName);

              if (grossAmountCents > 0 && commissionPercent > 0) {
                await insertAffiliateLedgerEntry({
                  affiliateUserId,
                  referredUserId: profileId,
                  stripeEventId: event.id,
                  stripeSubscriptionId: pseudoSubscriptionId, // tie to pseudo record for audit
                  tierName,
                  grossAmountCents,
                  commissionPercent,
                });
              }
            }
          }

          break;
        }

        break;
      }

      default: {
        console.log("ℹ️ Ignoring unsupported event type:", event.type);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("🔥 Webhook processing error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Webhook handler failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" });
}
