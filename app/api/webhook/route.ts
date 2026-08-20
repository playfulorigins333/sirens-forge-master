import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findProfileIdByStripeCustomer(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  stripeCustomerId: string,
  fallbackProfileId?: string | null
): Promise<string | null> {
  if (!stripeCustomerId && !fallbackProfileId) return null

  if (stripeCustomerId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", stripeCustomerId)
      .maybeSingle()

    if (error) {
      console.error("❌ Error finding profile by stripe_customer_id:", error)
    } else if (data?.id) {
      return data.id
    }
  }

  const safeFallbackId = fallbackProfileId && String(fallbackProfileId).trim()
  if (!safeFallbackId) return null

  const { data: fallbackProfile, error: fallbackError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", safeFallbackId)
    .maybeSingle()

  if (fallbackError) {
    console.error("❌ Error finding profile by metadata fallback:", fallbackError)
    return null
  }

  return fallbackProfile?.id ?? null
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
    .select("id, name, display_name, stripe_price_id, is_active")
    .eq("stripe_price_id", priceId)
    .eq("is_active", true)
    .maybeSingle()

  if (error) {
    console.error("❌ Error finding tier by priceId:", error)
    return null
  }

  return data ?? null
}

async function findTierByName(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  tierName: string | null | undefined
) {
  if (!tierName) return null

  const { data, error } = await supabaseAdmin
    .from("subscription_tiers")
    .select("id, name, display_name, stripe_price_id, is_active")
    .eq("name", tierName)
    .eq("is_active", true)
    .maybeSingle()

  if (error) {
    console.error("❌ Error finding tier by name:", error)
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

const RELEASE_FAILED = "AFFILIATE_COMMISSION_RELEASE_FAILED"
async function releaseAffiliateCommissions(admin: ReturnType<typeof getSupabaseAdmin>) {
  let result: any
  try { result = await admin.rpc("release_affiliate_commissions") } catch { throw new Error(RELEASE_FAILED) }
  if (!result || typeof result !== "object" || !Object.hasOwn(result, "error") || result.error != null) throw new Error(RELEASE_FAILED)
}

function deferAffiliateVoidProcessing(_reason: "subscription_deleted" | "invoice_payment_failed") {
  // Affiliate cancellation, failed-invoice, and void processing remain deferred.
}

async function grantOgThroneAccessFromCheckoutSession(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  session: any
) {
  const metadata = session.metadata ?? {}
  const tierName = metadata.tier_name ?? null

  // Business decision: og_throne is a one-time payment that grants lifetime app access.
  if (session.mode !== "payment" || tierName !== "og_throne") return

  if (session.payment_status && session.payment_status !== "paid") {
    console.log("ℹ️ Skipping og_throne access grant until payment is paid:", session.id)
    return
  }

  const stripeCustomerId = session.customer ? String(session.customer) : ""
  const profileId = await findProfileIdByStripeCustomer(
    supabaseAdmin,
    stripeCustomerId,
    metadata.profile_id ?? session.client_reference_id ?? null
  )

  if (!profileId) {
    console.error("❌ Could not resolve profile for og_throne checkout:", session.id)
    return
  }

  const tier = await findTierByName(supabaseAdmin, "og_throne")
  if (!tier) {
    console.error("❌ Active og_throne tier not found for checkout:", session.id)
    return
  }

  const periodStart = session.created
    ? new Date(session.created * 1000).toISOString()
    : new Date().toISOString()

  const accessRow = {
    user_id: profileId,
    tier_id: tier.id,
    tier_name: "og_throne",
    stripe_subscription_id: null,
    stripe_customer_id: stripeCustomerId || null,
    status: "active",
    current_period_start: periodStart,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    metadata: {
      checkout_session_id: session.id ?? null,
      payment_intent: session.payment_intent ? String(session.payment_intent) : null,
      stripe_price_id: metadata.stripe_price_id ?? tier.stripe_price_id ?? null,
      access_type: "one_time_lifetime",
      tier_name: "og_throne",
    },
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("user_subscriptions")
    .select("id")
    .eq("user_id", profileId)
    .eq("tier_name", "og_throne")
    .in("status", ["active", "trialing"])
    .order("current_period_start", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) {
    console.error("❌ Error checking existing og_throne access:", existingError)
    return
  }

  const query = existing?.id
    ? supabaseAdmin.from("user_subscriptions").update(accessRow).eq("id", existing.id)
    : supabaseAdmin.from("user_subscriptions").insert(accessRow)

  const { error } = await query

  if (error) {
    console.error("❌ Error granting og_throne access:", error)
  }
}

async function upsertUserSubscriptionFromStripe(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  sub: any,
  metadataFallback: Record<string, any> = {}
) {
  const stripeCustomerId = String(sub.customer)
  const stripeSubscriptionId = sub.id

  const metadata = { ...(sub.metadata ?? {}), ...metadataFallback }
  const profileId = await findProfileIdByStripeCustomer(
    supabaseAdmin,
    stripeCustomerId,
    metadata.profile_id ?? metadata.user_id ?? null
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
        tier_name: tier.name,
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
          checkout_user_id: metadata.user_id ?? null,
          checkout_profile_id: metadata.profile_id ?? null,
          checkout_tier_name: metadata.tier_name ?? null,
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

type LegacyWebhookDependencies = {
  constructEvent(payload: string, signature: string | null): any
  getSupabaseAdmin(): ReturnType<typeof getSupabaseAdmin>
  retrieveSubscription(id: string): Promise<any>
}

function hasPaymentV2Discriminator(obj: any): boolean {
  if (obj?.metadata?.checkout_contract_version === "pfc-03-v2") return true
  if (obj?.subscription && typeof obj.subscription === "object" && obj.subscription.metadata?.checkout_contract_version === "pfc-03-v2") return true
  if (Array.isArray(obj?.lines?.data)) {
    return obj.lines.data.some((line: any) => line?.subscription && typeof line.subscription === "object" && line.subscription.metadata?.checkout_contract_version === "pfc-03-v2")
  }
  return false
}

export async function handleLegacyStripeWebhook(payload: string, signature: string | null, deps: LegacyWebhookDependencies) {
  let event: Stripe.Event

  try {
    event = deps.constructEvent(payload, signature)
  } catch (err: any) {
    console.error("❌ Invalid Stripe signature:", err.message)
    return new NextResponse("Invalid signature", { status: 400 })
  }

  console.log("🔔 Stripe Event:", event.type)

  const eventObject: any = event.data?.object
  if (hasPaymentV2Discriminator(eventObject)) {
    return NextResponse.json({ received: true, ignored: true, code: "PAYMENT_V2_EVENT_IGNORED_BY_LEGACY_WEBHOOK" })
  }

  const supabaseAdmin = deps.getSupabaseAdmin()

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
          const sub = await deps.retrieveSubscription(String(session.subscription))
          if (hasPaymentV2Discriminator(sub)) break
          await upsertUserSubscriptionFromStripe(supabaseAdmin, sub, {
            ...(session.metadata ?? {}),
            profile_id: session.metadata?.profile_id ?? session.client_reference_id ?? null,
          })
        }

        if (session.mode === "payment") {
          await grantOgThroneAccessFromCheckoutSession(supabaseAdmin, session)
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
          await releaseAffiliateCommissions(supabaseAdmin)
        }

        break
      }

      case "customer.subscription.deleted": {
        deferAffiliateVoidProcessing("subscription_deleted")

        break
      }

      // -------------------------------------------------
      // INVOICES
      // -------------------------------------------------
      case "invoice.payment_succeeded": {
        const invoice: any = event.data.object

        // 🚫 DO NOT release unless destination charge was used
        if (destinationChargeUsed(invoice)) {
          await releaseAffiliateCommissions(supabaseAdmin)
        }

        break
      }

      case "invoice.payment_failed": {
        const invoice: any = event.data.object

        if (invoice.subscription) {
          deferAffiliateVoidProcessing("invoice_payment_failed")
        }

        break
      }

      default:
        console.log("ℹ️ Ignored event:", event.type)
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    if (err instanceof Error && err.message === RELEASE_FAILED) {
      return NextResponse.json(
        { error: "Unable to release affiliate commissions", code: RELEASE_FAILED },
        { status: 500 },
      )
    }
    console.error("🔥 Webhook error:", err)
    return NextResponse.json(
      { error: err?.message ?? "Webhook failed" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured", code: "STRIPE_WEBHOOK_NOT_CONFIGURED" },
      { status: 500 },
    )
  }
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2025-11-17.clover" as any,
  })
  const signature = req.headers.get("stripe-signature")
  const payload = await req.text()
  return handleLegacyStripeWebhook(payload, signature, {
    constructEvent: (body, sig) => stripe.webhooks.constructEvent(body, sig!, webhookSecret),
    getSupabaseAdmin,
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
  })
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" })
}
