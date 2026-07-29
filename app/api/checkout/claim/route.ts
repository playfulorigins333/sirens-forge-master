import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { LAUNCH_PLAN_POLICY, isPurchasablePlan } from "@/lib/billing/launchCheckoutPolicy";
import { PAY_FIRST_CHECKOUT_CONTRACT, PURCHASER_COOKIE, hashPurchaserToken, purchaserCookieOptions, readPurchaserCookie } from "@/lib/billing/payFirstCheckout";

type Purchase={reservation_id:string;purchaser_token_hash:string;tier:"og_throne"|"early_bird";stripe_session_id:string;stripe_customer_id:string;stripe_price_id:string;payment_intent_id:string|null;stripe_subscription_id:string|null;state:"paid_unclaimed"|"claimed";claimed_profile_id:string|null};
export type ClaimDependencies={authenticate():Promise<{id:string}|null>;profiles(userId:string):Promise<{id:string;user_id:string}[]>;purchase(reservation:string,session:string):Promise<Purchase|null>;session(id:string):Promise<any>;subscription(id:string):Promise<any>;claim(input:{reservation:string;hash:string;session:string;profile:string;user:string;subscriptionStatus:string|null}):Promise<string>};
const safe=(state:string,status=200)=>NextResponse.json({state},{status});
const ids=(req:Request)=>{const u=new URL(req.url),reservation=u.searchParams.get("reservation")||"",session=u.searchParams.get("session_id")||"";return /^[0-9a-f-]{36}$/i.test(reservation)&&/^cs_[A-Za-z0-9_]{8,120}$/.test(session)?{reservation,session}:null};
const objectId=(v:any)=>typeof v==="string"?v:typeof v?.id==="string"?v.id:"";
export function createClaimHandler(deps:ClaimDependencies){return async(req:Request)=>{
 const requested=ids(req);if(!requested)return safe("invalid",400);const token=readPurchaserCookie(req.headers.get("cookie"));if(!token)return safe("unavailable",403);let hash:string;try{hash=hashPurchaserToken(token)}catch{return safe("unavailable",403)}
 try{const purchase=await deps.purchase(requested.reservation,requested.session);if(!purchase||purchase.purchaser_token_hash.toLowerCase().replace(/^\\x/,"")!==hash||!isPurchasablePlan(purchase.tier))return safe("unavailable",404);if(purchase.state==="claimed")return safe("claimed");
  const user=await deps.authenticate();if(!user)return safe("ready_to_claim",401);if(req.method!=="POST")return safe("ready_to_claim");const profiles=await deps.profiles(user.id);if(profiles.length!==1||profiles[0].user_id!==user.id)return safe("unavailable",409);
  const session=await deps.session(requested.session),customer=objectId(session.customer);if(session.id!==requested.session||session.metadata?.checkout_contract!==PAY_FIRST_CHECKOUT_CONTRACT||session.metadata?.reservation_id!==requested.reservation||session.metadata?.tier_name!==purchase.tier||session.metadata?.stripe_price_id!==purchase.stripe_price_id||customer!==purchase.stripe_customer_id||session.status!=="complete"||session.payment_status!=="paid"||session.mode!==LAUNCH_PLAN_POLICY[purchase.tier].mode)return safe("unavailable",409);
  let subscriptionStatus:string|null=null;if(purchase.tier==="og_throne"){if(objectId(session.payment_intent)!==purchase.payment_intent_id)return safe("unavailable",409)}else{if(objectId(session.subscription)!==purchase.stripe_subscription_id)return safe("unavailable",409);const sub=await deps.subscription(purchase.stripe_subscription_id!);subscriptionStatus=String(sub.status||"");if(!["active","trialing"].includes(subscriptionStatus)||objectId(sub.customer)!==purchase.stripe_customer_id)return safe("unavailable",409)}
  await deps.claim({reservation:requested.reservation,hash,session:requested.session,profile:profiles[0].id,user:user.id,subscriptionStatus});const out=safe("claimed");out.cookies.set(PURCHASER_COOKIE,"",{...purchaserCookieOptions(process.env.NODE_ENV==="production"),maxAge:0});return out;
 }catch{return safe("awaiting_confirmation",202)}
}}
function productionDependencies():ClaimDependencies{const db=()=>{const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("unavailable");return createClient(url,key)};const stripe=()=>new Stripe(process.env.STRIPE_SECRET_KEY!,{apiVersion:"2025-11-17.clover"});return{
 async authenticate(){const auth=await supabaseServer();const{data,error}=await auth.auth.getUser();return error?null:data.user},
 async profiles(user){const{data,error}=await db().from("profiles").select("id,user_id").eq("user_id",user).limit(2);if(error)throw error;return data||[]},
 async purchase(reservation,session){const{data,error}=await db().from("pay_first_purchases").select("*").eq("reservation_id",reservation).eq("stripe_session_id",session).maybeSingle();if(error)throw error;return data},
 async session(id){return stripe().checkout.sessions.retrieve(id)},async subscription(id){return stripe().subscriptions.retrieve(id)},
 async claim(i){const{data,error}=await db().rpc("claim_pay_first_purchase",{p_reservation_id:i.reservation,p_purchaser_token_hash:`\\x${i.hash}`,p_session_id:i.session,p_profile_id:i.profile,p_auth_user_id:i.user,p_subscription_status:i.subscriptionStatus});if(error)throw error;return data}
}}
export async function GET(req:Request){return createClaimHandler(productionDependencies())(req)} export async function POST(req:Request){return createClaimHandler(productionDependencies())(req)}
