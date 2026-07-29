import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { LAUNCH_CHECKOUT_CONTRACT, isPurchasablePlan } from "@/lib/billing/launchCheckoutPolicy"

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

export type LaunchWebhookDependencies = {
  ogPriceId: string
  fulfill(input: { contract:string;reservationId:string;profileId:string;userId:string;tier:"og_throne";priceId:string;customerId:string;paymentIntentId:string;sessionId:string|null }): Promise<unknown>
  expire(input: { reservationId:string;profileId:string;tier:"og_throne"|"early_bird";sessionId:string }): Promise<unknown>
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : "" }
function customerId(value: any) { return text(typeof value === "string" ? value : value?.id) }
function validMetadata(md: any, deps: LaunchWebhookDependencies) {
  return md?.checkout_contract === LAUNCH_CHECKOUT_CONTRACT && md?.tier_name === "og_throne" &&
    text(md.profile_id) && text(md.user_id) && text(md.reservation_id) && text(md.stripe_price_id) === deps.ogPriceId && text(md.stripe_customer_id)
}
function validConnect(object: any, md: any) {
  const destination = text(object?.transfer_data?.destination)
  const fee = object?.application_fee_amount
  if (md.connect_mode === "none") {
    return text(md.connect_destination_account) === "" && destination === "" &&
      (fee == null || (Number.isSafeInteger(fee) && fee <= 0))
  }
  if (md.connect_mode !== "destination_charge" || md.connect_onboarded !== "true") return false
  const configuredDestination = text(md.connect_destination_account)
  const amount = object?.amount
  const platform = typeof md.platform_fee_percent === "string" && md.platform_fee_percent.trim() ? Number(md.platform_fee_percent) : NaN
  const commission = typeof md.commission_percent === "string" && md.commission_percent.trim() ? Number(md.commission_percent) : NaN
  return configuredDestination !== "" && destination === configuredDestination &&
    Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(fee) && fee >= 0 &&
    Number.isFinite(platform) && platform >= 0 && platform <= 100 &&
    Number.isFinite(commission) && commission >= 0 && commission <= 100 &&
    Math.abs(platform + commission - 100) < 1e-9 && fee === Math.round(amount * platform / 100)
}

export async function processLaunchStripeEvent(event: any, deps: LaunchWebhookDependencies): Promise<"ignored"|"fulfilled"|"expired"> {
  if (event?.type === "checkout.session.expired") {
    const session=event.data?.object, md=session?.metadata
    if (md?.checkout_contract !== LAUNCH_CHECKOUT_CONTRACT || !isPurchasablePlan(md?.tier_name) || !text(session?.id) || !text(md?.reservation_id) || !text(md?.profile_id)) return "ignored"
    await deps.expire({reservationId:md.reservation_id,profileId:md.profile_id,tier:md.tier_name,sessionId:session.id}); return "expired"
  }
  if (event?.type === "checkout.session.completed") {
    const session=event.data?.object, md=session?.metadata, customer=customerId(session?.customer), pi=customerId(session?.payment_intent)
    if (session?.mode!=="payment" || session?.payment_status!=="paid" || !validMetadata(md,deps) || customer!==md.stripe_customer_id || !pi) return "ignored"
    if (md.connect_mode !== "none") return "ignored" // destination relationship is validated on payment_intent.succeeded
    await deps.fulfill({contract:md.checkout_contract,reservationId:md.reservation_id,profileId:md.profile_id,userId:md.user_id,tier:"og_throne",priceId:md.stripe_price_id,customerId:customer,paymentIntentId:pi,sessionId:session.id}); return "fulfilled"
  }
  if (event?.type === "payment_intent.succeeded") {
    const pi=event.data?.object, md=pi?.metadata, customer=customerId(pi?.customer)
    if (pi?.status!=="succeeded" || !text(pi?.id) || !validMetadata(md,deps) || customer!==md.stripe_customer_id || !validConnect(pi,md)) return "ignored"
    await deps.fulfill({contract:md.checkout_contract,reservationId:md.reservation_id,profileId:md.profile_id,userId:md.user_id,tier:"og_throne",priceId:md.stripe_price_id,customerId:customer,paymentIntentId:pi.id,sessionId:null}); return "fulfilled"
  }
  return "ignored"
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature")
  const payload = await req.text()

  let event: Stripe.Event

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-11-17.clover" as any })
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
    const supabaseAdmin = getSupabaseAdmin()
    const launchResult = await processLaunchStripeEvent(event, {
      ogPriceId: process.env.STRIPE_PRICE_OG_THRONE || "",
      async fulfill(input) { const {error}=await supabaseAdmin.rpc("fulfill_og_checkout_payment",{p_checkout_contract:input.contract,p_reservation_id:input.reservationId,p_profile_id:input.profileId,p_user_id:input.userId,p_tier:input.tier,p_price_id:input.priceId,p_customer_id:input.customerId,p_payment_intent_id:input.paymentIntentId,p_session_id:input.sessionId}); if(error) throw new Error("fulfillment_unavailable") },
      async expire(input) { const {error}=await supabaseAdmin.rpc("expire_checkout_capacity_reservation_from_session",{p_reservation_id:input.reservationId,p_profile_id:input.profileId,p_tier:input.tier,p_session_id:input.sessionId}); if(error) throw new Error("expiration_unavailable") },
    })
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-11-17.clover" as any })
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
          await upsertUserSubscriptionFromStripe(supabaseAdmin, sub, {
            ...(session.metadata ?? {}),
            profile_id: session.metadata?.profile_id ?? session.client_reference_id ?? null,
          })
        }

        if (session.mode === "payment" && launchResult === "ignored") console.log("ℹ️ Ignored non-final OG checkout session")

        break
      }

      case "payment_intent.succeeded":
      case "checkout.session.expired":
        break

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
      { error: "webhook_processing_failed" },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ message: "Stripe Webhook Live" })
}
