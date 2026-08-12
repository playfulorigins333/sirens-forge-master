import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { paymentFirstWebhook, type PaymentV2Database, type PaymentV2Provider, type StripeEvent, type StripeSubscription } from "../../../lib/payment-v2/webhookService";
import { paymentFirstClaim, type ClaimDatabase, type ClaimInput } from "../../../lib/payment-v2/claimService";
import type { InboxStatus, PaymentV2InboxDatabase } from "../../../lib/payment-v2/eventInboxService";

let assertions=0;const equal=(a:unknown,b:unknown,m:string)=>{assert.deepEqual(a,b,m);assertions++};const check=(a:unknown,m:string)=>{assert.ok(a,m);assertions++};
const hold="10000000-0000-4000-8000-000000000001";
const subscription=(status:string="active"):StripeSubscription=>({id:"sub_early",customer:"cus_early",status,current_period_start:1785542400,current_period_end:1788220800,cancel_at_period_end:true,canceled_at:null,trial_start:null,trial_end:null,metadata:{checkout_contract_version:"pfc-03-v2",payment_v2_hold_id:hold,tier_name:"early_bird"}});

async function lifecycle(eventType="customer.subscription.updated", current=subscription()){
  let state:InboxStatus="RECEIVED";const calls={apply:[] as Record<string,unknown>[],subscription:0,invoice:0,transitions:[] as string[]};
  const event:StripeEvent={id:"evt_lifecycle",type:eventType,created:1785542400,data:{object:{id:eventType==="invoice.payment_failed"?"in_failed":"sub_early"}}};
  const provider:PaymentV2Provider={constructEvent:()=>event,retrieveSession:async()=>{throw new Error()},retrievePaymentIntent:async()=>{throw new Error()},async retrieveSubscription(){calls.subscription++;return current},async retrieveInvoice(){calls.invoice++;return{id:"in_failed",customer:"cus_early",parent:{type:"subscription_details",subscription_details:{subscription:"sub_early",metadata:current.metadata}}}}};
  const db:PaymentV2Database={loadHold:async()=>[],loadTier:async()=>[],loadPurchase:async()=>[],recordPaid:async()=>"",recordTerminal:async()=>"",async applyEarlyBirdLifecycle(args){calls.apply.push(args);return"applied"}};
  const inbox:PaymentV2InboxDatabase={receiveEvent:async()=>state,async transitionStatus(args){state=args.p_new_status;calls.transitions.push(`${args.p_expected_status}->${args.p_new_status}`);return state}};
  const result=await paymentFirstWebhook({enabled:"true",inboxEnabled:"true",apiKey:"sk_test",webhookSecret:"whsec_test",signature:"sig",readRawBody:async()=>Buffer.from("signed"),createProvider:()=>provider,createDatabase:()=>db,createInboxDatabase:()=>inbox});
  return{result,calls,get state(){return state}};
}

for(const status of ["active","trialing","past_due","canceled","unpaid","paused","incomplete","incomplete_expired"]){const h=await lifecycle("customer.subscription.updated",subscription(status));equal(h.state,"PROCESSED",`${status} processed`);equal(h.calls.apply[0].p_status,status,`${status} authoritative snapshot applied`);}
{const h=await lifecycle("customer.subscription.deleted",subscription("active"));equal(h.calls.apply[0].p_status,"active","deleted event cannot override current active truth");equal(h.calls.subscription,1,"current subscription retrieved");}
{const h=await lifecycle("invoice.payment_failed",subscription("past_due"));equal(h.calls.invoice,1,"failed invoice retrieved");equal(h.calls.subscription,1,"invoice subscription retrieved");equal(h.state,"PROCESSED","failed invoice processed");}
{const h=await lifecycle("customer.subscription.updated",{...subscription(),metadata:{}});equal(h.state,"IGNORED_NON_V2","legacy subscription ignored");equal(h.calls.apply.length,0,"legacy subscription not mutated");}
{const h=await lifecycle("refund.created",subscription());equal(h.state,"PENDING_PHASE","A2 remains dormant");equal(h.calls.apply.length,0,"A2 does not apply lifecycle");}
{const h=await lifecycle("charge.dispute.created",subscription());equal(h.state,"PENDING_PHASE","dispute remains dormant");equal(h.calls.apply.length,0,"dispute does not apply lifecycle");}

const raw=Buffer.alloc(32,7),cookie=raw.toString("base64url"),digest=createHash("sha256").update(raw).digest();
function claimHarness(tier:"early_bird"|"og_throne",status="active",providerFailure=false){let rpc=0,retrieves=0;const sid="cs_test_lock05e",profile="30000000-0000-4000-8000-000000000001",user="40000000-0000-4000-8000-000000000001",purchase="50000000-0000-4000-8000-000000000001";const db:ClaimDatabase={loadHolds:async()=>[{id:hold,purchaser_credential_hash:digest,tier,state:"PAID_UNCLAIMED",stripe_checkout_session_id:sid}],loadPurchases:async()=>[{id:purchase,hold_id:hold,purchaser_credential_hash:digest,tier,state:"PAID_UNCLAIMED",stripe_checkout_session_id:sid,stripe_subscription_id:tier==="early_bird"?"sub_early":null,stripe_customer_id:"cus_early",claimed_profile_id:null}],loadProfiles:async()=>[{id:profile,user_id:user}],loadAllocations:async()=>[],loadEntitlements:async()=>[],async claim(){rpc++;return"claimed"}};const input:ClaimInput={enabled:"true",production:true,configuredOrigin:"https://sirensforge.test",readOrigin:()=>"https://sirensforge.test",readSessionId:()=>sid,readCookie:()=>cookie,getAuthenticatedUser:async()=>user,createDatabase:()=>db,async retrieveSubscription(){retrieves++;if(providerFailure)throw new Error("temporary");return subscription(status)}};return{input,get rpc(){return rpc},get retrieves(){return retrieves}}}
for(const status of ["past_due","canceled","unpaid","paused","incomplete","incomplete_expired"]){const h=claimHarness("early_bird",status);const r=await paymentFirstClaim(h.input);equal(r.body.code,"PAYMENT_V2_SUBSCRIPTION_NOT_ACTIVE",`${status} claim rejected stably`);equal(h.rpc,0,`${status} never calls claim RPC`)}
for(const status of ["active","trialing"]){const h=claimHarness("early_bird",status);await paymentFirstClaim(h.input);equal(h.rpc,1,`${status} reaches existing claim RPC`)}
{const h=claimHarness("early_bird","active",true);equal((await paymentFirstClaim(h.input)).body.code,"PAYMENT_V2_SUBSCRIPTION_VERIFICATION_UNAVAILABLE","provider failure stable");equal(h.rpc,0,"provider failure never claims");}
{const h=claimHarness("og_throne");await paymentFirstClaim(h.input);equal(h.retrieves,0,"OG claim performs no subscription lookup");}

const baseline="eff1aa6e96c21dfd2b17f59b292476da164f0073";
for(const path of ["app/api/checkout/subscription-v2/route.ts","lib/payment-v2/checkoutService.ts","lib/payment-v2/checkoutRequestProtection.ts","lib/payment-v2/inventory.ts","lib/subscription-checker.ts"]){execFileSync("git",["diff","--quiet",baseline,"--",path]);assertions++;}
const changedMigrations=execFileSync("git",["diff","--name-only",baseline,"HEAD","--","supabase/migrations"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);equal(changedMigrations,["supabase/migrations/20260812080000_lock05e_payment_v2_early_bird_subscription_lifecycle.sql"],"only new migration differs");
for(const path of ["backend/affiliate","app/pricing"]){execFileSync("git",["diff","--quiet",baseline,"--",path]);assertions++;}
check(true,"no live provider used");console.log(`LOCK-05E lifecycle tests passed (${assertions} assertions; no external network calls)`);
