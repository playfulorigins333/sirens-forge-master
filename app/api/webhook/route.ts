import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
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

  const { error } = await supabaseAdmin
    .from("user_subscriptions")
    .upsert(
      {
        user_id: profileId,
        tier_id: tier.id,
        tier_name: tier.display_name ?? tier.name,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: stripeCustomerId,
        status,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        canceled_at: sub.canceled_at
          ? new Date(sub.canceled_at * 1000).toISOString()
          : null,
        trial_start: trialStart,
        trial_end: trialEnd,
        metadata: {
          stripe_price_id: priceId,
        },
      },
      { onConflict: "stripe_subscription_id" }
    );

  if (error) {
    console.error("❌ Supabase error upserting user_subscriptions:", error);
  }
}

// ---------------------------------------------------------------------------
// Route
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
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub: any = event.data.object;
        await upsertUserSubscriptionFromStripe(sub);

        // 🔓 Release commissions if cooldown passed
        await supabaseAdmin.rpc("release_affiliate_commissions");
        break;
      }

      case "customer.subscription.deleted": {
        const sub: any = event.data.object;

        // ❌ Void commissions immediately
        await supabaseAdmin.rpc("void_affiliate_commissions", {
          p_stripe_subscription_id: String(sub.id),
        });

        break;
      }

      case "invoice.payment_succeeded": {
        // 🔓 Attempt unlock after payment success
        await supabaseAdmin.rpc("release_affiliate_commissions");
        break;
      }

      case "invoice.payment_failed": {
        const invoice: any = event.data.object;

        if (invoice.subscription) {
          await supabaseAdmin.rpc("void_affiliate_commissions", {
            p_stripe_subscription_id: String(invoice.subscription),
          });
        }

        break;
      }

      case "checkout.session.completed": {
        const session: any = event.data.object;

        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            String(session.subscription)
          );

          await upsertUserSubscriptionFromStripe(sub);

          // 🔓 Release if eligible
          await supabaseAdmin.rpc("release_affiliate_commissions");
        }

        break;
      }

      default:
        console.log("ℹ️ Ignoring event type:", event.type);
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
