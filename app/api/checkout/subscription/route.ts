import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { normalizeReferral } from "@/lib/auth/checkoutContinuation";
import { CHECKOUT_ERROR, LAUNCH_PLAN_POLICY, checkoutSessionIdempotencyKey, isPurchasablePlan, paymentMethodTypesForLaunchPlan, type PurchasablePlan } from "@/lib/billing/launchCheckoutPolicy";
import { PAY_FIRST_CHECKOUT_CONTRACT, PURCHASER_COOKIE, generatePurchaserToken, hashPurchaserToken, purchaserCookieOptions, readPurchaserCookie } from "@/lib/billing/payFirstCheckout";
import { checkoutCreationConfiguration, checkoutSupabaseUrl, PAY_FIRST_HOLD_SECONDS, payFirstCheckoutEnabled } from "@/lib/billing/checkoutCreationSecurity";

export const runtime="nodejs"; export const dynamic="force-dynamic";
type Reservation={reservation_id:string;expires_at:string;stripe_session_id?:string|null;reservation_tier?:PurchasablePlan};
type SwitchResult=Reservation&{switch_outcome:"switched"|"closed_sold_out"|"closed_rate_limited"|"closed_plan_unavailable"|"closed_database_failure"};
type Referral={code:string|null;affiliateUserId:string|null;commissionPercent:number;destination:string|null;connectOnboarded:boolean;payable:boolean};
export type CheckoutDependencies={
 enabled():boolean; preflight(plan:PurchasablePlan,req:Request):{priceId:string;baseUrl:string;networkHash:string}|null;
 privileged():Promise<{tier(plan:PurchasablePlan):Promise<{is_active:boolean}|null>;reserve(hash:string,networkHash:string,plan:PurchasablePlan):Promise<Reservation>;switchReservation(hash:string,networkHash:string,plan:PurchasablePlan,id:string,session:string):Promise<SwitchResult>;release(hash:string,plan:PurchasablePlan,id:string):Promise<void>;associate(hash:string,plan:PurchasablePlan,id:string,session:string):Promise<void>;referral(code:string|null):Promise<Referral>}>;
 retrievePrice(id:string):Promise<{unitAmount:number|null}>;
 createSession(input:any,key:string):Promise<{id:string;url:string|null}>; retrieveSession(id:string):Promise<{id:string;url:string|null;status?:string|null}>; expireSession(id:string):Promise<{id:string;status?:string|null}>;
 generateToken():string;
};
type CheckoutEnvironment={readonly [name:string]:string|undefined};
export function productionCheckoutConfiguration(environment:CheckoutEnvironment,plan:PurchasablePlan,request:Request){
 const supabaseUrl=checkoutSupabaseUrl(environment.SUPABASE_URL,environment.NEXT_PUBLIC_SUPABASE_URL);
 return{enabled:payFirstCheckoutEnabled(environment.PAY_FIRST_CHECKOUT_ENABLED),supabaseUrl,configuration:checkoutCreationConfiguration({request,rateLimitSecret:environment.CHECKOUT_RATE_LIMIT_SECRET,supabaseUrl:supabaseUrl??undefined,serviceRoleKey:environment.SUPABASE_SERVICE_ROLE_KEY,stripeSecret:environment.STRIPE_SECRET_KEY,priceId:environment[LAUNCH_PLAN_POLICY[plan].priceEnvironment],canonicalUrl:environment.NEXT_PUBLIC_APP_URL})};
}
const response=(code:string,status:number)=>NextResponse.json({error:code,code},{status});
type FailureCategory="activation"|"configuration"|"reservation"|"database"|"provider"|"cleanup";
type FailureStage="activation_gate"|"preflight"|"database_initialization"|"tier_lookup"|"reservation_acquire"|"reservation_validate"|"plan_switch_expiration"|"plan_switch_commit"|"referral_lookup"|"price_retrieval"|"session_retrieval"|"session_creation"|"session_validation"|"session_association"|"reservation_release";
class CheckoutFailure extends Error{constructor(readonly category:FailureCategory,readonly stage:FailureStage,readonly code:string,readonly status:number){super(code)}}
const logFailure=(category:FailureCategory,stage:FailureStage)=>console.error("checkout_creation_failure",{category,stage});
const boundary=async<T>(category:FailureCategory,stage:FailureStage,code:string,status:number,work:()=>Promise<T>)=>{try{return await work()}catch{throw new CheckoutFailure(category,stage,code,status)}};
export const clampCommissionPercent=(v:unknown)=>Math.min(100,Math.max(0,Number.isFinite(Number(v))?Number(v):0));
export function createCheckoutHandler(deps:CheckoutDependencies){return async(req:Request)=>{
 let held:{hash:string;plan:PurchasablePlan;id:string;db:Awaited<ReturnType<CheckoutDependencies["privileged"]>>}|null=null,providerMayExist=false;
 try{
  if(!deps.enabled())throw new CheckoutFailure("activation","activation_gate",CHECKOUT_ERROR.CHECKOUT_INACTIVE,503);
  const body=await req.json().catch(()=>({})); const plan=body?.tierName??body?.tier;
  if(!isPurchasablePlan(plan))return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,400);
  const suppliedKeys=Object.keys(body||{}); if(suppliedKeys.some(k=>!["tier","tierName","referral","referralCode"].includes(k)))return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,400);
  let config:ReturnType<CheckoutDependencies["preflight"]>;try{config=deps.preflight(plan,req)}catch{throw new CheckoutFailure("configuration","preflight",CHECKOUT_ERROR.CHECKOUT_CONFIGURATION_FAILURE,503)}if(!config)throw new CheckoutFailure("configuration","preflight",CHECKOUT_ERROR.CHECKOUT_CONFIGURATION_FAILURE,503);
  const existing=readPurchaserCookie(req.headers.get("cookie")); const token=existing||deps.generateToken(); const hash=hashPurchaserToken(token);
  const db=await boundary("database","database_initialization",CHECKOUT_ERROR.CHECKOUT_DATABASE_FAILURE,503,deps.privileged);
  const tier=await boundary("database","tier_lookup",CHECKOUT_ERROR.CHECKOUT_DATABASE_FAILURE,503,()=>db.tier(plan)); if(!tier?.is_active)return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,409);
  let reservation:Reservation; try{reservation=await db.reserve(hash,config.networkHash,plan)}catch(e:any){const detail=String(e?.code||e?.message);if(detail.includes("rate_limit_hourly")||detail.includes("rate_limit_daily"))return response(CHECKOUT_ERROR.RATE_LIMITED,429);if(detail.includes("sold_out"))return response(CHECKOUT_ERROR.SOLD_OUT,409);throw new CheckoutFailure("reservation","reservation_acquire",CHECKOUT_ERROR.CHECKOUT_RESERVATION_FAILURE,503)}
  if(reservation.reservation_tier&&reservation.reservation_tier!==plan){
   const oldTier=reservation.reservation_tier; const oldSession=reservation.stripe_session_id||null;
   if(!oldSession)return response(CHECKOUT_ERROR.PLAN_SWITCH_UNAVAILABLE,409);
   try{const current=await deps.retrieveSession(oldSession);if(current.id!==oldSession||!current.status||!['open','expired','complete'].includes(current.status))throw new Error("unsafe_state");if(current.status==='complete')return response(CHECKOUT_ERROR.PLAN_SWITCH_UNAVAILABLE,409);if(current.status==='open'){const expired=await deps.expireSession(oldSession);if(expired.id!==oldSession||expired.status!=="expired")throw new Error("not_expired")}}catch{logFailure("provider","plan_switch_expiration");return response(CHECKOUT_ERROR.PLAN_SWITCH_UNAVAILABLE,409)}
   let switched:SwitchResult;try{switched=await db.switchReservation(hash,config.networkHash,plan,reservation.reservation_id,oldSession)}catch{logFailure("database","plan_switch_commit");return response(CHECKOUT_ERROR.PLAN_SWITCH_RETRY,409)}
   if(switched.switch_outcome==="closed_sold_out")return response(CHECKOUT_ERROR.SOLD_OUT,409);if(switched.switch_outcome==="closed_rate_limited")return response(CHECKOUT_ERROR.RATE_LIMITED,429);if(switched.switch_outcome!=="switched")return response(CHECKOUT_ERROR.PLAN_SWITCH_RETRY,409);reservation=switched;
   console.info("checkout_plan_switch",{outcome:"replaced",from:oldTier,to:plan});
  }
  const expires=Math.floor(new Date(reservation?.expires_at).getTime()/1000),now=Math.floor(Date.now()/1000);
  if(!reservation||typeof reservation.reservation_id!=="string"||!reservation.reservation_id||!Number.isSafeInteger(expires)||expires<=now||expires>now+PAY_FIRST_HOLD_SECONDS+5)throw new CheckoutFailure("reservation","reservation_validate",CHECKOUT_ERROR.CHECKOUT_RESERVATION_FAILURE,503);
  held={hash,plan,id:reservation.reservation_id,db};
  if(reservation.stripe_session_id){providerMayExist=true;const retry=await boundary("provider","session_retrieval",CHECKOUT_ERROR.CHECKOUT_PROVIDER_FAILURE,502,()=>deps.retrieveSession(reservation.stripe_session_id!));if(retry.id===reservation.stripe_session_id&&retry.status==="open"&&retry.url&&/^https:\/\/checkout\.stripe\.com\//.test(retry.url)){const out=NextResponse.json({url:retry.url});out.cookies.set(PURCHASER_COOKIE,token,purchaserCookieOptions(process.env.NODE_ENV==="production"));return out}throw new CheckoutFailure("provider","session_validation",CHECKOUT_ERROR.CHECKOUT_PROVIDER_FAILURE,502)}
  const referral=await boundary("database","referral_lookup",CHECKOUT_ERROR.CHECKOUT_DATABASE_FAILURE,503,()=>db.referral(normalizeReferral(body?.referralCode??body?.referral))); const commission=clampCommissionPercent(referral.commissionPercent),platform=clampCommissionPercent(100-commission);
  const connect=referral.payable&&referral.connectOnboarded&&referral.destination?"destination_charge":"none";
  const metadata={checkout_contract:PAY_FIRST_CHECKOUT_CONTRACT,reservation_id:reservation.reservation_id,tier_name:plan,stripe_price_id:config.priceId,referral_code:referral.code||"",affiliate_user_id:referral.affiliateUserId||"",commission_percent:String(commission),platform_fee_percent:String(platform),connect_destination_account:referral.destination||"",connect_onboarded:referral.connectOnboarded?"true":"false",connect_mode:connect,purchase_mode:LAUNCH_PLAN_POLICY[plan].mode};
  const input:any={mode:LAUNCH_PLAN_POLICY[plan].mode,customer_creation:plan==="og_throne"?"always":undefined,payment_method_types:paymentMethodTypesForLaunchPlan(plan,process.env.STRIPE_OG_BNPL_METHODS),line_items:[{price:config.priceId,quantity:1}],success_url:`${config.baseUrl}/checkout/complete?session_id={CHECKOUT_SESSION_ID}&reservation=${encodeURIComponent(reservation.reservation_id)}`,cancel_url:`${config.baseUrl}/pricing?checkout=canceled&tier=${plan}`,expires_at:expires,metadata};
  if(plan==="og_throne"){input.payment_intent_data={metadata};if(connect==="destination_charge"){const price=await boundary("provider","price_retrieval",CHECKOUT_ERROR.CHECKOUT_PROVIDER_FAILURE,502,()=>deps.retrievePrice(config.priceId));if(!Number.isSafeInteger(price.unitAmount)||(price.unitAmount as number)<0)throw new CheckoutFailure("provider","price_retrieval",CHECKOUT_ERROR.CHECKOUT_PROVIDER_FAILURE,502);input.payment_intent_data.application_fee_amount=Math.round((price.unitAmount as number)*platform/100);input.payment_intent_data.transfer_data={destination:referral.destination}}}
  else{input.subscription_data={metadata};if(connect==="destination_charge"){input.subscription_data.application_fee_percent=platform;input.subscription_data.transfer_data={destination:referral.destination}}}
  providerMayExist=true;
  const session=await boundary("provider","session_creation",CHECKOUT_ERROR.CHECKOUT_PROVIDER_FAILURE,502,()=>deps.createSession(input,checkoutSessionIdempotencyKey(reservation.reservation_id)));if(!session.id||!session.url||!/^https:\/\/checkout\.stripe\.com\//.test(session.url))throw new CheckoutFailure("provider","session_validation",CHECKOUT_ERROR.CHECKOUT_PROVIDER_FAILURE,502);
  await boundary("database","session_association",CHECKOUT_ERROR.CHECKOUT_DATABASE_FAILURE,503,()=>db.associate(hash,plan,reservation.reservation_id,session.id));held=null;const out=NextResponse.json({url:session.url});out.cookies.set(PURCHASER_COOKIE,token,purchaserCookieOptions(process.env.NODE_ENV==="production"));return out;
 }catch(error){const failure=error instanceof CheckoutFailure?error:new CheckoutFailure("database","database_initialization",CHECKOUT_ERROR.CHECKOUT_DATABASE_FAILURE,503);if(held&&!providerMayExist)try{await held.db.release(held.hash,held.plan,held.id)}catch{logFailure("cleanup","reservation_release")};logFailure(failure.category,failure.stage);return response(failure.code,failure.status)}
}}
function productionDependencies():CheckoutDependencies{let resolvedSupabaseUrl:string|null=null;return{
 enabled(){return payFirstCheckoutEnabled(process.env.PAY_FIRST_CHECKOUT_ENABLED)},
 preflight(plan,req){const resolved=productionCheckoutConfiguration(process.env,plan,req);resolvedSupabaseUrl=resolved.supabaseUrl;return resolved.configuration},
 generateToken:generatePurchaserToken,
 async privileged(){const url=resolvedSupabaseUrl,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("unavailable");const db=createClient(url,key);return{
  async tier(plan){const{data,error}=await db.from("subscription_tiers").select("is_active").eq("name",plan).maybeSingle();if(error)throw error;return data},
  async reserve(hash,networkHash,plan){const{data,error}=await db.rpc("acquire_guest_checkout_capacity_reservation",{p_purchaser_token_hash:`\\x${hash}`,p_network_hash:`\\x${networkHash}`,p_tier:plan});if(error||!data?.[0]){const e:any=new Error(error?.message||"reservation");e.code=error?.message||"UNAVAILABLE";throw e}return data[0]},
  async switchReservation(hash,networkHash,plan,id,session){const{data,error}=await db.rpc("switch_guest_checkout_capacity_reservation",{p_purchaser_token_hash:`\\x${hash}`,p_network_hash:`\\x${networkHash}`,p_tier:plan,p_previous_reservation_id:id,p_previous_session_id:session});if(error||!data?.[0])throw new Error(error?.message||"switch_unavailable");return data[0]},
  async release(hash,plan,id){const{error}=await db.from("checkout_capacity_reservations").update({status:"released"}).eq("id",id).eq("tier",plan).eq("purchaser_token_hash",`\\x${hash}`).eq("status","active").is("stripe_session_id",null);if(error)throw error},
  async associate(hash,plan,id,session){const{error}=await db.rpc("bind_guest_checkout_session",{p_reservation_id:id,p_purchaser_token_hash:`\\x${hash}`,p_tier:plan,p_session_id:session});if(error)throw error},
  async referral(code){if(!code)return{code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false};const{data:r,error}=await db.from("referral_codes").select("*").eq("code",code).maybeSingle();if(error)throw error;if(!r)return{code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false};const affiliateUserId=r.affiliate_user_id||r.affiliate_id||r.user_id||r.owner_user_id||null,commissionPercent=clampCommissionPercent(r.commission_percent??r.percent??r.commission_rate);if(!affiliateUserId)return{code,affiliateUserId:null,commissionPercent,destination:null,connectOnboarded:false,payable:false};const{data:a,error:profileError}=await db.from("profiles").select("stripe_connect_account_id,stripe_connect_onboarded").eq("id",affiliateUserId).maybeSingle();if(profileError)throw profileError;const destination=a?.stripe_connect_onboarded&&a?.stripe_connect_account_id?String(a.stripe_connect_account_id):null;return{code,affiliateUserId,commissionPercent,destination,connectOnboarded:Boolean(a?.stripe_connect_onboarded),payable:Boolean(destination)}}}
 },
 async retrievePrice(id){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");const p=await new Stripe(secret,{apiVersion:"2025-11-17.clover"}).prices.retrieve(id);return{unitAmount:p.unit_amount}},
 async createSession(input,key){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.create(input,{idempotencyKey:key})},
 async retrieveSession(id){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.retrieve(id)}
 ,async expireSession(id){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.expire(id)}
}}
export async function POST(req:Request){return createCheckoutHandler(productionDependencies())(req)}
