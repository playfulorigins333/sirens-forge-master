import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover" as any,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findProfileIdByStripeCustomer(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  stripeCustomerId: string
): Promise<string | null> {
  if (!stripeCustomerId) return null

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle()

  if (error) {
    console.error("❌ Error finding profile by stripe_customer_id:", error)
    return null
  }

  return data?.id ?? null
}

async function findProfileByConnectAccount(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  connectAccountId: string
): Promise<string | null> {
  if (!connectAccountId) return null

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_connect_account_id", connectAccountId)
    .maybeSingle()

  if (error) {
    console.error(
      "❌ Error finding profile by stripe_connect_account_id:",
      error
    )
    return null
  }

  return data?.id ?? null
}

async function findTierByPriceId(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  priceId: string | null | undefined
) {
  if (!priceId) return null

  const { data, error } = await supabaseAdmin
    .from("subscription_tiers")
    .select("id, name, display_name, stripe_price_id")
    .eq("stripe_price_id", priceId)
    .maybeSingle()

  if (error) {
    console.error("❌ Error finding tier by priceId:", error)
    return null
  }

  return data ?? null
}

/**
 * HARD SAFETY CHECK
 * Commission may only unlock if destination charge was used
 */
function destinationChargeUsed(obj: any): boolean {
  const md = obj?.metadata ?? {}
  return (
    md.connect_mode === "destination_charge" &&
    typeof md.connect_destination_account === "string" &&
    md.connect_destination_account.length > 0
  )
}

async function upsertUserSubscriptionFromStripe(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  sub: any
) {
  const stripeCustomerId = String(sub.customer)
  const stripeSubscriptionId = sub.id

  const profileId = await findProfileIdByStripeCustomer(
    supabaseAdmin,
    stripeCustomerId
  )
  if (!profileId) return

  const firstItem = sub.items?.data?.[0]
  const priceId = firstItem?.price?.id ?? null

  const tier = await findTierByPriceId(supabaseAdmin, priceId)
  if (!tier) return

  const status = sub.status ?? "active"

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
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        canceled_at: sub.canceled_at
          ? new Date(sub.canceled_at * 1000).toISOString()
          : null,
        trial_start: sub.trial_start
          ? new Date(sub.trial_start * 1000).toISOString()
          : null,
        trial_end: sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null,
        metadata: {
          stripe_price_id: priceId,
        },
      },
      { onConflict: "stripe_subscription_id" }
    )

  if (error) {
    console.error("❌ Error upserting user_subscriptions:", error)
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin()

  const signature = req.headers.get("stripe-signature")
  const payload = await req.text()

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error("❌ Invalid Stripe signature:", err.message)
    return new NextResponse("Invalid signature", { status: 400 })
  }

  console.log("🔔 Stripe Event:", event.type)

  try {
    switch (event.type) {
      // -------------------------------------------------
      // STRIPE CONNECT — ONBOARDING COMPLETE
      // -------------------------------------------------
      case "account.updated": {
        const account: any = event.data.object

        if (account.charges_enabled && account.payouts_enabled) {
          const profileId = await findProfileByConnectAccount(
            supabaseAdmin,
            account.id
          )

          if (profileId) {
            await supabaseAdmin
              .from("profiles")
              .update({ stripe_connect_onboarded: true })
              .eq("id", profileId)

            console.log("✅ Connect onboarded:", profileId)
          }
        }
        break
      }

      // -------------------------------------------------
      // CHECKOUT SESSION
      // -------------------------------------------------
      case "checkout.session.completed": {
        const session: any = event.data.object

        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            String(session.subscription)
          )
          await upsertUserSubscriptionFromStripe(supabaseAdmin, sub)
        }

        break
      }

      // -------------------------------------------------
      // SUBSCRIPTIONS
      // -------------------------------------------------
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub: any = event.data.object
        await upsertUserSubscriptionFromStripe(supabaseAdmin, sub)

        // 🚫 Only release commissions if destination charge confirmed
        if (destinationChargeUsed(sub)) {
          await supabaseAdmin.rpc("release_affiliate_commissions")
        }

        break
      }

      case "customer.subscription.deleted": {
        const sub: any = event.data.object

        await supabaseAdmin.rpc("void_affiliate_commissions", {
          p_stripe_subscription_id: String(sub.id),
        })

        break
      }

      // -------------------------------------------------
      // INVOICES
      // -------------------------------------------------
      case "invoice.payment_succeeded": {
        const invoice: any = event.data.object

        // 🚫 DO NOT release unless destination charge was used
        if (destinationChargeUsed(invoice)) {
          await supabaseAdmin.rpc("release_affiliate_commissions")
        }

        break
      }

      case "invoice.payment_failed": {
        const invoice: any = event.data.object

        if (invoice.subscription) {
          await supabaseAdmin.rpc("void_affiliate_commissions", {
            p_stripe_subscription_id: String(invoice.subscription),
          })
        }

        break
      }

      default:
        console.log("ℹ️ Ignored event:", event.type)
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error("🔥 Webhook error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Webhook failed" },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" })
}
