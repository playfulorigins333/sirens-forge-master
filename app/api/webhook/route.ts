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

        if (session.mode === "subscription" && session.subscription) {
          const sub: any = await stripe.subscriptions.retrieve(
            String(session.subscription)
          );

          await upsertUserSubscriptionFromStripe(sub);
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
