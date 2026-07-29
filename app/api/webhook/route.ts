import { NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabaseAdmin } from "@/lib/supabaseAdmin"
import { LAUNCH_CHECKOUT_CONTRACT, isPurchasablePlan } from "@/lib/billing/launchCheckoutPolicy"
import { PAY_FIRST_CHECKOUT_CONTRACT } from "@/lib/billing/payFirstCheckout"

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

type PayFirstReservation={id:string;purchaser_token_hash:string|null;tier:string;status:string;stripe_session_id:string|null;stripe_subscription_id:string|null};
type ExistingPayFirstPurchase={reservation_id:string;purchaser_token_hash:string;tier:string;stripe_session_id:string;stripe_customer_id:string;stripe_price_id:string;payment_intent_id:string|null;stripe_subscription_id:string|null;state:string};
export type PayFirstWebhookDependencies={ogPriceId:string;earlyPriceId:string;reservation(id:string):Promise<PayFirstReservation|null>;purchase(id:string):Promise<ExistingPayFirstPurchase|null>;session(id:string):Promise<any>;paymentIntent(id:string):Promise<any>;subscription(id:string):Promise<any>;record(input:{reservationId:string;tokenHash:string;tier:"og_throne"|"early_bird";sessionId:string;customerId:string;priceId:string;paymentIntentId:string|null;subscriptionId:string|null}):Promise<unknown>;expire(input:{reservationId:string;tier:"og_throne"|"early_bird";sessionId:string}):Promise<unknown>};
function validPayFirstMetadata(md:any,tier:string,price:string){return md?.checkout_contract===PAY_FIRST_CHECKOUT_CONTRACT&&md?.tier_name===tier&&text(md.reservation_id)&&text(md.stripe_price_id)===price&&md.purchase_mode===(tier==="og_throne"?"payment":"subscription")}
function validSubscriptionConnect(sub:any,md:any){const destination=text(sub?.transfer_data?.destination),fee=sub?.application_fee_percent,configured=text(md.connect_destination_account),platform=Number(md.platform_fee_percent),commission=Number(md.commission_percent);if(md.connect_mode==="none")return configured===""&&destination===""&&(fee==null||fee===0);return md.connect_mode==="destination_charge"&&md.connect_onboarded==="true"&&configured!==""&&destination===configured&&Number.isFinite(platform)&&platform>=0&&platform<=100&&Number.isFinite(commission)&&commission>=0&&commission<=100&&Math.abs(platform+commission-100)<1e-9&&fee===platform}
const PAY_FIRST_METADATA_AGREEMENT=["checkout_contract","reservation_id","tier_name","stripe_price_id","purchase_mode","connect_mode","connect_destination_account","connect_onboarded","platform_fee_percent","commission_percent","referral_code","affiliate_user_id"];
function matchingPayFirstMetadata(a:any,b:any){return PAY_FIRST_METADATA_AGREEMENT.every(key=>text(a?.[key])===text(b?.[key]))}
function exactOgLineItem(session:any,price:string){const items=session?.line_items?.data;return Array.isArray(items)&&items.length===1&&customerId(items[0]?.price)===price&&items[0]?.quantity===1}
function exactExistingPurchase(existing:ExistingPayFirstPurchase,reservation:PayFirstReservation,session:any,pi:any,price:string){
 const ownership=reservation.status==="fulfilled"||existing.purchaser_token_hash===reservation.purchaser_token_hash;
 return ownership&&existing.reservation_id===reservation.id&&existing.tier==="og_throne"&&existing.stripe_session_id===session.id&&existing.stripe_customer_id===customerId(session.customer)&&existing.stripe_price_id===price&&existing.payment_intent_id===pi.id&&existing.stripe_subscription_id==null;
}
async function finalizePayFirstOg(input:{metadata:any;eventSession?:any;paymentIntentId:string;paymentIntentEvent?:any;sessionSignal:boolean},deps:PayFirstWebhookDependencies):Promise<"ignored"|"recorded">{
 const md=input.metadata;if(!validPayFirstMetadata(md,"og_throne",deps.ogPriceId))return"ignored";
 const reservation=await deps.reservation(md.reservation_id);if(!reservation||reservation.id!==md.reservation_id||reservation.tier!=="og_throne"||!reservation.stripe_session_id||reservation.stripe_subscription_id)return"ignored";
 if(input.eventSession&&input.eventSession.id!==reservation.stripe_session_id)return"ignored";
 const existing=await deps.purchase(reservation.id);
 if(!existing&&(reservation.status!=="associated"||!reservation.purchaser_token_hash))return"ignored";
 if(existing&&!["associated","fulfilled"].includes(reservation.status))throw new Error("purchase_replay_conflict");
 const session=await deps.session(reservation.stripe_session_id),pi=await deps.paymentIntent(input.paymentIntentId);
 if(session?.id!==reservation.stripe_session_id||session?.mode!=="payment"||session?.status!=="complete"||customerId(session.customer)===""||customerId(session.payment_intent)!==input.paymentIntentId||!validPayFirstMetadata(session.metadata,"og_throne",deps.ogPriceId)||!exactOgLineItem(session,deps.ogPriceId))return"ignored";
 if(input.sessionSignal&&(session.payment_status!=="paid"||input.eventSession?.status!=="complete"||input.eventSession?.payment_status!=="paid"||customerId(input.eventSession?.customer)!==customerId(session.customer)||customerId(input.eventSession?.payment_intent)!==pi.id||!matchingPayFirstMetadata(input.eventSession?.metadata,session.metadata)))return"ignored";
 if(pi?.id!==input.paymentIntentId||pi?.status!=="succeeded"||customerId(pi.customer)!==customerId(session.customer)||!validPayFirstMetadata(pi.metadata,"og_throne",deps.ogPriceId)||!matchingPayFirstMetadata(session.metadata,pi.metadata)||!validConnect(pi,session.metadata))return"ignored";
 if(input.paymentIntentEvent&&(input.paymentIntentEvent.id!==pi.id||input.paymentIntentEvent.status!=="succeeded"||!matchingPayFirstMetadata(input.paymentIntentEvent.metadata,pi.metadata)))return"ignored";
 if(existing){if(!exactExistingPurchase(existing,reservation,session,pi,deps.ogPriceId))throw new Error("purchase_replay_conflict");return"recorded"}
 await deps.record({reservationId:reservation.id,tokenHash:reservation.purchaser_token_hash!,tier:"og_throne",sessionId:session.id,customerId:customerId(session.customer),priceId:deps.ogPriceId,paymentIntentId:pi.id,subscriptionId:null});return"recorded";
}
export async function processPayFirstStripeEvent(event:any,deps:PayFirstWebhookDependencies):Promise<"ignored"|"recorded"|"expired">{
 const session=event?.data?.object,md=session?.metadata;if(md?.checkout_contract!==PAY_FIRST_CHECKOUT_CONTRACT)return"ignored";
 if(event.type==="checkout.session.expired"){if(!isPurchasablePlan(md.tier_name)||!text(session.id)||!text(md.reservation_id))return"ignored";if(await deps.purchase(md.reservation_id))return"ignored";await deps.expire({reservationId:md.reservation_id,tier:md.tier_name,sessionId:session.id});return"expired"}
 if(event.type==="payment_intent.succeeded"&&md.tier_name==="og_throne"){if(session.status!=="succeeded"||!text(session.id))return"ignored";return finalizePayFirstOg({metadata:md,paymentIntentId:session.id,paymentIntentEvent:session,sessionSignal:false},deps)}
 if(event.type==="payment_intent.canceled"&&md.tier_name==="og_throne"){if(session.status!=="canceled"||!validPayFirstMetadata(md,"og_throne",deps.ogPriceId))return"ignored";const reservation=await deps.reservation(md.reservation_id);if(!reservation||reservation.id!==md.reservation_id||reservation.tier!=="og_throne"||reservation.status!=="associated"||!reservation.stripe_session_id||reservation.stripe_subscription_id||await deps.purchase(reservation.id))return"ignored";const stored=await deps.session(reservation.stripe_session_id);if(stored.id!==reservation.stripe_session_id||stored.status!=="complete"||stored.payment_status==="paid"||customerId(stored.payment_intent)!==session.id||customerId(stored.customer)!==customerId(session.customer)||!exactOgLineItem(stored,deps.ogPriceId)||!matchingPayFirstMetadata(stored.metadata,md))return"ignored";await deps.expire({reservationId:reservation.id,tier:"og_throne",sessionId:stored.id});return"expired"}
 if((event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded")&&md.tier_name==="og_throne"){if(session.status!=="complete"||session.payment_status!=="paid")return"ignored";const pi=customerId(session.payment_intent);if(!pi)return"ignored";return finalizePayFirstOg({metadata:md,eventSession:session,paymentIntentId:pi,sessionSignal:true},deps)}
 if(event.type!=="checkout.session.completed"||!isPurchasablePlan(md.tier_name)||!text(session.id)||session.status!=="complete"||session.payment_status!=="paid")return"ignored";
 const tier=md.tier_name,price=tier==="og_throne"?deps.ogPriceId:deps.earlyPriceId,customer=customerId(session.customer);if(!price||!customer||!validPayFirstMetadata(md,tier,price)||session.mode!==(tier==="og_throne"?"payment":"subscription"))return"ignored";
 const id=customerId(session.subscription);if(!id)return"ignored";const sub=await deps.subscription(id),itemPrice=customerId(sub?.items?.data?.[0]?.price),invoice=sub?.latest_invoice,invoicePaid=invoice?.paid===true||invoice?.status==="paid";if(sub.id!==id||!["active","trialing"].includes(sub.status)||customerId(sub.customer)!==customer||itemPrice!==price||!validPayFirstMetadata(sub.metadata,tier,price)||!invoicePaid||!validSubscriptionConnect(sub,md))return"ignored";
 await deps.record({reservationId:md.reservation_id,tokenHash:"",tier,sessionId:session.id,customerId:customer,priceId:price,paymentIntentId:null,subscriptionId:id});return"recorded";
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
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-11-17.clover" as any })
    const payFirstResult=await processPayFirstStripeEvent(event,{
      ogPriceId:process.env.STRIPE_PRICE_OG_THRONE||"",earlyPriceId:process.env.STRIPE_PRICE_EARLY_BIRD||"",
      async reservation(id){const{data,error}=await supabaseAdmin.from("checkout_capacity_reservations").select("id,purchaser_token_hash,tier,status,stripe_session_id,stripe_subscription_id").eq("id",id).maybeSingle();if(error)throw new Error("reservation_unavailable");return data},
      async purchase(id){const{data,error}=await supabaseAdmin.from("pay_first_purchases").select("reservation_id,purchaser_token_hash,tier,stripe_session_id,stripe_customer_id,stripe_price_id,payment_intent_id,stripe_subscription_id,state").eq("reservation_id",id).maybeSingle();if(error)throw new Error("purchase_unavailable");return data},
      async session(id){return stripe.checkout.sessions.retrieve(id,{expand:["line_items"]})},
      async paymentIntent(id){return stripe.paymentIntents.retrieve(id)},async subscription(id){return stripe.subscriptions.retrieve(id,{expand:["latest_invoice"]})},
      async record(input){let tokenHash=input.tokenHash;if(!tokenHash){const{data:r,error:q}=await supabaseAdmin.from("checkout_capacity_reservations").select("purchaser_token_hash").eq("id",input.reservationId).maybeSingle();if(q||!r?.purchaser_token_hash)throw new Error("reservation_unavailable");tokenHash=r.purchaser_token_hash}const{error}=await supabaseAdmin.rpc("record_pay_first_purchase",{p_reservation_id:input.reservationId,p_purchaser_token_hash:tokenHash,p_tier:input.tier,p_session_id:input.sessionId,p_customer_id:input.customerId,p_price_id:input.priceId,p_payment_intent_id:input.paymentIntentId,p_subscription_id:input.subscriptionId});if(error)throw new Error("purchase_record_unavailable")},
      async expire(input){const{error}=await supabaseAdmin.rpc("expire_guest_checkout_session",{p_reservation_id:input.reservationId,p_tier:input.tier,p_session_id:input.sessionId});if(error)throw new Error("expiration_unavailable")}
    })
    const launchResult = await processLaunchStripeEvent(event, {
      ogPriceId: process.env.STRIPE_PRICE_OG_THRONE || "",
      async fulfill(input) { const {error}=await supabaseAdmin.rpc("fulfill_og_checkout_payment",{p_checkout_contract:input.contract,p_reservation_id:input.reservationId,p_profile_id:input.profileId,p_user_id:input.userId,p_tier:input.tier,p_price_id:input.priceId,p_customer_id:input.customerId,p_payment_intent_id:input.paymentIntentId,p_session_id:input.sessionId}); if(error) throw new Error("fulfillment_unavailable") },
      async expire(input) { const {error}=await supabaseAdmin.rpc("expire_checkout_capacity_reservation_from_session",{p_reservation_id:input.reservationId,p_profile_id:input.profileId,p_tier:input.tier,p_session_id:input.sessionId}); if(error) throw new Error("expiration_unavailable") },
    })
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

        if (payFirstResult === "recorded") break

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
