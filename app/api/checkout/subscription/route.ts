import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { normalizeReferral } from "@/lib/auth/checkoutContinuation";
import { CHECKOUT_ERROR, LAUNCH_PLAN_POLICY, checkoutSessionIdempotencyKey, isPurchasablePlan, paymentMethodTypesForLaunchPlan, type PurchasablePlan } from "@/lib/billing/launchCheckoutPolicy";
import { PAY_FIRST_CHECKOUT_CONTRACT, PURCHASER_COOKIE, generatePurchaserToken, hashPurchaserToken, purchaserCookieOptions, readPurchaserCookie } from "@/lib/billing/payFirstCheckout";
import { checkoutCreationConfiguration, PAY_FIRST_HOLD_SECONDS, payFirstCheckoutEnabled } from "@/lib/billing/checkoutCreationSecurity";

export const runtime="nodejs"; export const dynamic="force-dynamic";
type Reservation={reservation_id:string;expires_at:string;stripe_session_id?:string|null};
type Referral={code:string|null;affiliateUserId:string|null;commissionPercent:number;destination:string|null;connectOnboarded:boolean;payable:boolean};
export type CheckoutDependencies={
 enabled():boolean; preflight(plan:PurchasablePlan,req:Request):{priceId:string;baseUrl:string;networkHash:string}|null;
 privileged():Promise<{tier(plan:PurchasablePlan):Promise<{is_active:boolean}|null>;reserve(hash:string,networkHash:string,plan:PurchasablePlan):Promise<Reservation>;release(hash:string,plan:PurchasablePlan,id:string):Promise<void>;associate(hash:string,plan:PurchasablePlan,id:string,session:string):Promise<void>;referral(code:string|null):Promise<Referral>}>;
 retrievePrice(id:string):Promise<{unitAmount:number|null}>;
 createSession(input:any,key:string):Promise<{id:string;url:string|null}>; retrieveSession(id:string):Promise<{id:string;url:string|null;status?:string|null}>;
 generateToken():string;
};
const response=(code:string,status:number)=>NextResponse.json({error:code,code},{status});
export const clampCommissionPercent=(v:unknown)=>Math.min(100,Math.max(0,Number.isFinite(Number(v))?Number(v):0));
export function createCheckoutHandler(deps:CheckoutDependencies){return async(req:Request)=>{
 let held:{hash:string;plan:PurchasablePlan;id:string;db:Awaited<ReturnType<CheckoutDependencies["privileged"]>>}|null=null,providerExists=false;
 try{
  if(!deps.enabled())return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE,503);
  const body=await req.json().catch(()=>({})); const plan=body?.tierName??body?.tier;
  if(!isPurchasablePlan(plan))return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,400);
  const suppliedKeys=Object.keys(body||{}); if(suppliedKeys.some(k=>!["tier","tierName","referral","referralCode"].includes(k)))return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,400);
  const config=deps.preflight(plan,req);if(!config)return response(CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE,503);
  const existing=readPurchaserCookie(req.headers.get("cookie")); const token=existing||deps.generateToken(); const hash=hashPurchaserToken(token);
  const db=await deps.privileged(); const tier=await db.tier(plan); if(!tier?.is_active)return response(CHECKOUT_ERROR.PLAN_UNAVAILABLE,409);
  let reservation:Reservation; try{reservation=await db.reserve(hash,config.networkHash,plan)}catch(e:any){const detail=String(e?.code||e?.message);if(detail.includes("rate_limit_hourly")||detail.includes("rate_limit_daily"))return response(CHECKOUT_ERROR.RATE_LIMITED,429);return response(detail.includes("sold_out")?CHECKOUT_ERROR.SOLD_OUT:CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE,detail.includes("sold_out")?409:503)}
  held={hash,plan,id:reservation.reservation_id,db};
  if(reservation.stripe_session_id){const retry=await deps.retrieveSession(reservation.stripe_session_id);if(retry.id===reservation.stripe_session_id&&retry.status==="open"&&retry.url&&/^https:\/\/checkout\.stripe\.com\//.test(retry.url)){const out=NextResponse.json({url:retry.url});out.cookies.set(PURCHASER_COOKIE,token,purchaserCookieOptions(process.env.NODE_ENV==="production"));return out}throw new Error("associated")}
  const referral=await db.referral(normalizeReferral(body?.referralCode??body?.referral)); const commission=clampCommissionPercent(referral.commissionPercent),platform=clampCommissionPercent(100-commission);
  const connect=referral.payable&&referral.connectOnboarded&&referral.destination?"destination_charge":"none";
  const metadata={checkout_contract:PAY_FIRST_CHECKOUT_CONTRACT,reservation_id:reservation.reservation_id,tier_name:plan,stripe_price_id:config.priceId,referral_code:referral.code||"",affiliate_user_id:referral.affiliateUserId||"",commission_percent:String(commission),platform_fee_percent:String(platform),connect_destination_account:referral.destination||"",connect_onboarded:referral.connectOnboarded?"true":"false",connect_mode:connect,purchase_mode:LAUNCH_PLAN_POLICY[plan].mode};
  const expires=Math.floor(new Date(reservation.expires_at).getTime()/1000),now=Math.floor(Date.now()/1000);if(!Number.isSafeInteger(expires)||expires<=now||expires>now+PAY_FIRST_HOLD_SECONDS+5)throw new Error("reservation");
  const input:any={mode:LAUNCH_PLAN_POLICY[plan].mode,customer_creation:plan==="og_throne"?"always":undefined,payment_method_types:paymentMethodTypesForLaunchPlan(plan,process.env.STRIPE_OG_BNPL_METHODS),line_items:[{price:config.priceId,quantity:1}],success_url:`${config.baseUrl}/checkout/complete?session_id={CHECKOUT_SESSION_ID}&reservation=${encodeURIComponent(reservation.reservation_id)}`,cancel_url:`${config.baseUrl}/pricing?checkout=canceled&tier=${plan}`,expires_at:expires,metadata};
  if(plan==="og_throne"){input.payment_intent_data={metadata};if(connect==="destination_charge"){const price=await deps.retrievePrice(config.priceId);if(!Number.isSafeInteger(price.unitAmount)||(price.unitAmount as number)<0)throw new Error("price");input.payment_intent_data.application_fee_amount=Math.round((price.unitAmount as number)*platform/100);input.payment_intent_data.transfer_data={destination:referral.destination}}}
  else{input.subscription_data={metadata};if(connect==="destination_charge"){input.subscription_data.application_fee_percent=platform;input.subscription_data.transfer_data={destination:referral.destination}}}
  const session=await deps.createSession(input,checkoutSessionIdempotencyKey(reservation.reservation_id));providerExists=true;if(!session.id||!session.url||!/^https:\/\/checkout\.stripe\.com\//.test(session.url))throw new Error("provider");
  await db.associate(hash,plan,reservation.reservation_id,session.id);held=null;const out=NextResponse.json({url:session.url});out.cookies.set(PURCHASER_COOKIE,token,purchaserCookieOptions(process.env.NODE_ENV==="production"));return out;
 }catch{if(held&&!providerExists)await held.db.release(held.hash,held.plan,held.id).catch(()=>undefined);return response(providerExists?CHECKOUT_ERROR.TEMPORARILY_UNAVAILABLE:CHECKOUT_ERROR.PROVIDER_FAILURE,providerExists?503:502)}
}}
function productionDependencies():CheckoutDependencies{return{
 enabled(){return payFirstCheckoutEnabled(process.env.PAY_FIRST_CHECKOUT_ENABLED)},
 preflight(plan,req){return checkoutCreationConfiguration({request:req,rateLimitSecret:process.env.CHECKOUT_RATE_LIMIT_SECRET,supabaseUrl:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY,stripeSecret:process.env.STRIPE_SECRET_KEY,priceId:process.env[LAUNCH_PLAN_POLICY[plan].priceEnvironment],canonicalUrl:process.env.NEXT_PUBLIC_APP_URL})},
 generateToken:generatePurchaserToken,
 async privileged(){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("unavailable");const db=createClient(url,key);return{
  async tier(plan){const{data,error}=await db.from("subscription_tiers").select("is_active").eq("name",plan).maybeSingle();if(error)throw error;return data},
  async reserve(hash,networkHash,plan){const{data,error}=await db.rpc("acquire_guest_checkout_capacity_reservation",{p_purchaser_token_hash:`\\x${hash}`,p_network_hash:`\\x${networkHash}`,p_tier:plan});if(error||!data?.[0]){const e:any=new Error(error?.message||"reservation");e.code=error?.message||"UNAVAILABLE";throw e}return data[0]},
  async release(hash,plan,id){const{error}=await db.from("checkout_capacity_reservations").update({status:"released"}).eq("id",id).eq("tier",plan).eq("purchaser_token_hash",`\\x${hash}`).eq("status","active").is("stripe_session_id",null);if(error)throw error},
  async associate(hash,plan,id,session){const{error}=await db.rpc("bind_guest_checkout_session",{p_reservation_id:id,p_purchaser_token_hash:`\\x${hash}`,p_tier:plan,p_session_id:session});if(error)throw error},
  async referral(code){if(!code)return{code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false};const{data:r,error}=await db.from("referral_codes").select("*").eq("code",code).maybeSingle();if(error||!r)return{code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false};const affiliateUserId=r.affiliate_user_id||r.affiliate_id||r.user_id||r.owner_user_id||null,commissionPercent=clampCommissionPercent(r.commission_percent??r.percent??r.commission_rate);if(!affiliateUserId)return{code,affiliateUserId:null,commissionPercent,destination:null,connectOnboarded:false,payable:false};const{data:a}=await db.from("profiles").select("stripe_connect_account_id,stripe_connect_onboarded").eq("id",affiliateUserId).maybeSingle();const destination=a?.stripe_connect_onboarded&&a?.stripe_connect_account_id?String(a.stripe_connect_account_id):null;return{code,affiliateUserId,commissionPercent,destination,connectOnboarded:Boolean(a?.stripe_connect_onboarded),payable:Boolean(destination)}}}
 },
 async retrievePrice(id){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");const p=await new Stripe(secret,{apiVersion:"2025-11-17.clover"}).prices.retrieve(id);return{unitAmount:p.unit_amount}},
 async createSession(input,key){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.create(input,{idempotencyKey:key})},
 async retrieveSession(id){const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("unavailable");return new Stripe(secret,{apiVersion:"2025-11-17.clover"}).checkout.sessions.retrieve(id)}
}}
export async function POST(req:Request){return createCheckoutHandler(productionDependencies())(req)}
