import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { LAUNCH_PLAN_POLICY, isPurchasablePlan } from "@/lib/billing/launchCheckoutPolicy";
import { PAY_FIRST_CHECKOUT_CONTRACT, PURCHASER_COOKIE, hashPurchaserToken, purchaserCookieOptions, readPurchaserCookie } from "@/lib/billing/payFirstCheckout";

type Tier = "og_throne" | "early_bird";
type Reservation = { id:string; profile_id:string|null; purchaser_token_hash:string|null; tier:Tier; status:string; stripe_session_id:string|null; payment_intent_id:string|null; stripe_subscription_id:string|null };
type Purchase = { reservation_id:string; purchaser_token_hash:string; tier:Tier; stripe_session_id:string; stripe_customer_id:string; stripe_price_id:string; payment_intent_id:string|null; stripe_subscription_id:string|null; state:"paid_unclaimed"|"claimed"; claimed_profile_id:string|null };
export type ClaimDependencies = {
  authenticate():Promise<{id:string}|null>;
  profiles(userId:string):Promise<{id:string;user_id:string}[]>;
  reservation(reservation:string):Promise<Reservation|null>;
  purchase(reservation:string,session:string):Promise<Purchase|null>;
  session(id:string):Promise<any>;
  paymentIntent(id:string):Promise<any>;
  subscription(id:string):Promise<any>;
  claim(input:{reservation:string;hash:string;session:string;profile:string;user:string;subscriptionStatus:string|null}):Promise<string>;
};
const safe = (state:string,status=200) => NextResponse.json({state},{status});
const ids = (req:Request) => { const u=new URL(req.url),reservation=u.searchParams.get("reservation")||"",session=u.searchParams.get("session_id")||""; return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservation)&&/^cs_[A-Za-z0-9_]{8,120}$/.test(session)?{reservation,session}:null; };
const objectId = (v:any) => typeof v==="string"?v:typeof v?.id==="string"?v.id:"";
const byteaHex = (v:string|null|undefined) => String(v||"").toLowerCase().replace(/^\\x/,"");
const linePrice = (session:any) => objectId(session?.line_items?.data?.[0]?.price);
const validReservationIdentity = (r:Reservation|null,id:string,session:string) => Boolean(r&&r.id===id&&r.stripe_session_id===session&&isPurchasablePlan(r.tier));
const validUnclaimedReservation = (r:Reservation|null,hash:string) => Boolean(r&&r.status==="associated"&&byteaHex(r.purchaser_token_hash)===hash&&!r.payment_intent_id&&!r.stripe_subscription_id);
const validClaimedReservation = (r:Reservation|null,p:Purchase,profile:string) => Boolean(r&&r.status==="fulfilled"&&r.profile_id===profile&&!r.purchaser_token_hash&&r.tier===p.tier&&r.stripe_session_id===p.stripe_session_id&&r.payment_intent_id===p.payment_intent_id&&r.stripe_subscription_id===p.stripe_subscription_id&&p.claimed_profile_id===profile);
const validMetadata = (value:any,purchase:Purchase) => value?.checkout_contract===PAY_FIRST_CHECKOUT_CONTRACT&&value?.reservation_id===purchase.reservation_id&&value?.tier_name===purchase.tier&&value?.stripe_price_id===purchase.stripe_price_id;

export function createClaimHandler(deps:ClaimDependencies){return async(req:Request)=>{
  const requested=ids(req); if(!requested)return safe("invalid",400);
  const token=readPurchaserCookie(req.headers.get("cookie")); if(!token)return safe("unavailable",403);
  let hash:string; try{hash=hashPurchaserToken(token)}catch{return safe("unavailable",403)}
  let reservation:Reservation|null;
  try{reservation=await deps.reservation(requested.reservation)}catch{return safe("temporarily_unavailable",503)}
  if(!validReservationIdentity(reservation,requested.reservation,requested.session))return safe("unavailable",409);
  let purchase:Purchase|null;
  try{purchase=await deps.purchase(requested.reservation,requested.session)}catch{return safe("temporarily_unavailable",503)}
  if(!purchase){
    if(!validUnclaimedReservation(reservation,hash))return safe("unavailable",409);
    try{
      const session=await deps.session(requested.session);
      if(session.id!==requested.session||session.metadata?.reservation_id!==requested.reservation||session.metadata?.checkout_contract!==PAY_FIRST_CHECKOUT_CONTRACT)return safe("unavailable",409);
      if(session.status==="expired")return safe("expired",410);
      if(session.status==="open")return safe("canceled",409);
      if(session.status==="complete"&&session.payment_status!=="paid")return safe("unpaid",402);
      if(session.status==="complete"&&session.payment_status==="paid")return safe("awaiting_confirmation",202);
      return safe("unavailable",409);
    }catch{return safe("awaiting_confirmation",202)}
  }
  if(byteaHex(purchase.purchaser_token_hash)!==hash||purchase.reservation_id!==requested.reservation||purchase.stripe_session_id!==requested.session||purchase.tier!==reservation!.tier)return safe("unavailable",409);
  if(purchase.state==="paid_unclaimed"&&!validUnclaimedReservation(reservation,hash))return safe("unavailable",409);
  let user:{id:string}|null; try{user=await deps.authenticate()}catch{return safe("temporarily_unavailable",503)}
  if(!user)return purchase.state==="paid_unclaimed"?safe("ready_to_claim",401):safe("unavailable",409);
  let profiles:{id:string;user_id:string}[]; try{profiles=await deps.profiles(user.id)}catch{return safe("temporarily_unavailable",503)}
  if(profiles.length!==1||profiles[0].user_id!==user.id)return safe("unavailable",409);
  const profile=profiles[0];
  if(purchase.state==="claimed")return validClaimedReservation(reservation,purchase,profile.id)?safe("claimed"):safe("claim_conflict",409);
  if(req.method!=="POST")return safe("ready_to_claim");
  try{
    const session=await deps.session(requested.session),customer=objectId(session.customer);
    if(session.id!==requested.session||session.status!=="complete"||session.payment_status!=="paid"||session.mode!==LAUNCH_PLAN_POLICY[purchase.tier].mode||customer!==purchase.stripe_customer_id||linePrice(session)!==purchase.stripe_price_id||!validMetadata(session.metadata,purchase))return safe("unavailable",409);
    let subscriptionStatus:string|null=null;
    if(purchase.tier==="og_throne"){
      if(objectId(session.payment_intent)!==purchase.payment_intent_id||purchase.stripe_subscription_id)return safe("unavailable",409);
      const pi=await deps.paymentIntent(purchase.payment_intent_id!);
      if(pi.id!==purchase.payment_intent_id||pi.status!=="succeeded"||objectId(pi.customer)!==customer||!validMetadata(pi.metadata,purchase))return safe("unavailable",409);
    }else{
      if(objectId(session.subscription)!==purchase.stripe_subscription_id||purchase.payment_intent_id)return safe("unavailable",409);
      const sub=await deps.subscription(purchase.stripe_subscription_id!); subscriptionStatus=String(sub.status||"");
      const invoice=sub.latest_invoice,invoicePaid=invoice?.paid===true||invoice?.status==="paid";
      if(sub.id!==purchase.stripe_subscription_id||!["active","trialing"].includes(subscriptionStatus)||objectId(sub.customer)!==customer||objectId(sub?.items?.data?.[0]?.price)!==purchase.stripe_price_id||!invoicePaid||!validMetadata(sub.metadata,purchase))return safe("unavailable",409);
    }
    try{await deps.claim({reservation:requested.reservation,hash,session:requested.session,profile:profile.id,user:user.id,subscriptionStatus})}catch{return safe("claim_conflict",409)}
    const out=safe("claimed"); out.cookies.set(PURCHASER_COOKIE,"",{...purchaserCookieOptions(process.env.NODE_ENV==="production"),maxAge:0}); return out;
  }catch{return safe("temporarily_unavailable",503)}
}}

function productionDependencies():ClaimDependencies{
  const db=()=>{const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("unavailable");return createClient(url,key)};
  const stripe=()=>new Stripe(process.env.STRIPE_SECRET_KEY!,{apiVersion:"2025-11-17.clover"});
  return{
    async authenticate(){const auth=await supabaseServer();const{data,error}=await auth.auth.getUser();return error?null:data.user},
    async profiles(user){const{data,error}=await db().from("profiles").select("id,user_id").eq("user_id",user).limit(2);if(error)throw error;return data||[]},
    async reservation(id){const{data,error}=await db().from("checkout_capacity_reservations").select("id,profile_id,purchaser_token_hash,tier,status,stripe_session_id,payment_intent_id,stripe_subscription_id").eq("id",id).maybeSingle();if(error)throw error;return data},
    async purchase(reservation,session){const{data,error}=await db().from("pay_first_purchases").select("*").eq("reservation_id",reservation).eq("stripe_session_id",session).maybeSingle();if(error)throw error;return data},
    async session(id){return stripe().checkout.sessions.retrieve(id,{expand:["line_items"]})},
    async paymentIntent(id){return stripe().paymentIntents.retrieve(id)},
    async subscription(id){return stripe().subscriptions.retrieve(id,{expand:["latest_invoice"]})},
    async claim(i){const{data,error}=await db().rpc("claim_pay_first_purchase",{p_reservation_id:i.reservation,p_purchaser_token_hash:`\\x${i.hash}`,p_session_id:i.session,p_profile_id:i.profile,p_auth_user_id:i.user,p_subscription_status:i.subscriptionStatus});if(error)throw error;return data}
  };
}
export async function GET(req:Request){return createClaimHandler(productionDependencies())(req)}
export async function POST(req:Request){return createClaimHandler(productionDependencies())(req)}
