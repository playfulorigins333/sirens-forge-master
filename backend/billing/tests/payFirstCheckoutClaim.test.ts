import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClaimHandler, type ClaimDependencies } from "../../../app/api/checkout/claim/route";
import { boundedCompletionState, COMPLETION_MAX_PENDING_ATTEMPTS, shouldPollCheckoutCompletion } from "../../../lib/billing/checkoutCompletion";
import { PAY_FIRST_CHECKOUT_CONTRACT, PURCHASER_COOKIE, hashPurchaserToken } from "../../../lib/billing/payFirstCheckout";
import { processPayFirstStripeEvent, type PayFirstWebhookDependencies } from "../../../app/api/webhook/route";

let assertions=0;
const equal=(actual:unknown,expected:unknown)=>{assert.deepEqual(actual,expected);assertions+=1};
const reservationId="11111111-1111-4111-8111-111111111111",token="A".repeat(43),hash=hashPurchaserToken(token),sessionId="cs_1234567890";
const metadata=(tier:"og_throne"|"early_bird")=>({checkout_contract:PAY_FIRST_CHECKOUT_CONTRACT,reservation_id:reservationId,tier_name:tier,stripe_price_id:tier==="og_throne"?"price_og":"price_early",purchase_mode:tier==="og_throne"?"payment":"subscription",connect_mode:"none",connect_destination_account:"",connect_onboarded:"false",platform_fee_percent:"100",commission_percent:"0"});
const reservation:any={id:reservationId,purchaser_token_hash:`\\x${hash}`,tier:"og_throne",status:"associated",stripe_session_id:sessionId,payment_intent_id:null,stripe_subscription_id:null};
const purchase:any={reservation_id:reservationId,purchaser_token_hash:`\\x${hash}`,tier:"og_throne",stripe_session_id:sessionId,stripe_customer_id:"cus_1",stripe_price_id:"price_og",payment_intent_id:"pi_1",stripe_subscription_id:null,state:"paid_unclaimed",claimed_profile_id:null};
const stripeSession=(tier:"og_throne"|"early_bird"="og_throne")=>({id:sessionId,status:"complete",payment_status:"paid",mode:tier==="og_throne"?"payment":"subscription",customer:"cus_1",payment_intent:tier==="og_throne"?"pi_1":null,subscription:tier==="early_bird"?"sub_1":null,line_items:{data:[{price:{id:tier==="og_throne"?"price_og":"price_early"}}]},metadata:metadata(tier)});
const baseDeps=():ClaimDependencies=>({authenticate:async()=>({id:"user_1"}),profiles:async()=>[{id:"profile_1",user_id:"user_1"}],reservation:async()=>reservation,purchase:async()=>purchase,session:async()=>stripeSession(),paymentIntent:async()=>({id:"pi_1",status:"succeeded",customer:"cus_1",metadata:metadata("og_throne")}),subscription:async()=>({}),claim:async()=>"claimed"});
const request=(method="POST",cookie=`${PURCHASER_COOKIE}=${token}`,reservation=reservationId,session=sessionId)=>new Request(`https://sirens.test/api/checkout/claim?session_id=${session}&reservation=${reservation}`,{method,headers:{cookie}});

// Ledger race: ownership and provider association are checked before pending is returned.
let deps=baseDeps();deps.purchase=async()=>null;
equal((await createClaimHandler(deps)(request("GET"))).status,202);
equal((await createClaimHandler(deps)(request("GET"))).headers.get("content-type")?.includes("application/json"),true);
deps.reservation=async()=>({...reservation,purchaser_token_hash:`\\x${"0".repeat(64)}`});equal((await createClaimHandler(deps)(request("GET"))).status,409);
deps=baseDeps();deps.purchase=async()=>null;deps.reservation=async()=>({...reservation,stripe_session_id:"cs_other12345678"});equal((await createClaimHandler(deps)(request("GET"))).status,409);
equal((await createClaimHandler(baseDeps())(request("GET","bad=cookie"))).status,403);
equal((await createClaimHandler(baseDeps())(request("GET",undefined,"22222222-2222-4222-8222-222222222222"))).status,409);

// Bounded completion polling and pending-to-ready transition policy.
equal(shouldPollCheckoutCompletion("awaiting_confirmation",1),true);
equal(shouldPollCheckoutCompletion("ready_to_claim",1),false);
equal(shouldPollCheckoutCompletion("awaiting_confirmation",COMPLETION_MAX_PENDING_ATTEMPTS),false);
equal(boundedCompletionState("awaiting_confirmation",COMPLETION_MAX_PENDING_ATTEMPTS),"unavailable");
const transition=["awaiting_confirmation","ready_to_claim"];equal(shouldPollCheckoutCompletion(transition[0],1),true);equal(shouldPollCheckoutCompletion(transition[1],2),false);

// Claimed ownership is resolved only after authentication and profile resolution.
const claimedDeps=(profile="profile_1"):ClaimDependencies=>({...baseDeps(),profiles:async()=>[{id:profile,user_id:"user_1"}],purchase:async()=>({...purchase,state:"claimed",claimed_profile_id:"profile_1"}),reservation:async()=>({...reservation,status:"fulfilled",profile_id:"profile_1",purchaser_token_hash:null,payment_intent_id:"pi_1"})});
let response=await createClaimHandler(claimedDeps())(request("GET",""));equal(response.status,200);equal((await response.json()).state,"claimed");equal(response.headers.get("set-cookie"),null);
response=await createClaimHandler(claimedDeps())(request("GET",`${PURCHASER_COOKIE}=${"B".repeat(43)}`));equal(response.status,200);equal(response.headers.get("set-cookie")?.includes("Max-Age=0"),true);
for(const cookie of ["",`${PURCHASER_COOKIE}=${token}`]){response=await createClaimHandler(claimedDeps("profile_other"))(request("GET",cookie));equal(response.status,409);equal((await response.json()).state,"claim_conflict")}
deps=claimedDeps();deps.authenticate=async()=>null;equal((await createClaimHandler(deps)(request("GET",""))).status,409);
equal((await createClaimHandler(baseDeps())(request("POST",""))).status,403);

// Reservation terminal and ownership states never claim.
for(const status of ["released","expired","fulfilled"]){deps=baseDeps();deps.reservation=async()=>({...reservation,status});equal((await createClaimHandler(deps)(request())).status,409)}
deps=baseDeps();deps.reservation=async()=>({...reservation,purchaser_token_hash:`\\x${"0".repeat(64)}`});equal((await createClaimHandler(deps)(request())).status,409);
deps=baseDeps();deps.reservation=async()=>({...reservation,stripe_session_id:"cs_wrong12345678"});equal((await createClaimHandler(deps)(request())).status,409);

// OG provider finality and deterministic transaction conflicts.
deps=baseDeps();deps.paymentIntent=async()=>({id:"pi_1",status:"processing",customer:"cus_1",metadata:metadata("og_throne")});equal((await createClaimHandler(deps)(request())).status,409);
deps=baseDeps();deps.session=async()=>({...stripeSession(),payment_intent:"pi_wrong"});equal((await createClaimHandler(deps)(request())).status,409);
deps=baseDeps();deps.claim=async()=>{throw new Error("claimed_by_other_profile")};response=await createClaimHandler(deps)(request());equal(response.status,409);equal((await response.json()).state,"claim_conflict");
response=await createClaimHandler(baseDeps())(request());equal(response.status,200);equal(response.headers.get("set-cookie")?.includes("Max-Age=0"),true);
deps=baseDeps();deps.reservation=async()=>({...reservation,expires_at:"2000-01-01T00:00:00Z"});equal((await createClaimHandler(deps)(request())).status,200);

// Early Bird revalidates Subscription identity, Customer, exact Price, state, and paid invoice.
const earlyPurchase={...purchase,tier:"early_bird",stripe_price_id:"price_early",payment_intent_id:null,stripe_subscription_id:"sub_1"};
const earlyReservation={...reservation,tier:"early_bird"};
const earlySub=()=>({id:"sub_1",status:"active",customer:"cus_1",items:{data:[{price:{id:"price_early"}}]},latest_invoice:{paid:true,status:"paid"},metadata:metadata("early_bird")});
const earlyDeps=():ClaimDependencies=>({...baseDeps(),reservation:async()=>earlyReservation,purchase:async()=>earlyPurchase,session:async()=>stripeSession("early_bird"),subscription:async()=>earlySub()});
equal((await createClaimHandler(earlyDeps())(request())).status,200);
for(const sub of [{...earlySub(),customer:"cus_wrong"},{...earlySub(),status:"canceled"},{...earlySub(),items:{data:[{price:{id:"price_wrong"}}]}},{...earlySub(),latest_invoice:{paid:false,status:"open"}}]){deps=earlyDeps();deps.subscription=async()=>sub;equal((await createClaimHandler(deps)(request())).status,409)}
deps=earlyDeps();deps.session=async()=>({...stripeSession("early_bird"),subscription:"sub_wrong"});equal((await createClaimHandler(deps)(request())).status,409);

// Webhook recording preserves distinct provider identities.
let calls:any[]=[];
const webhook:PayFirstWebhookDependencies={ogPriceId:"price_og",earlyPriceId:"price_early",paymentIntent:async id=>({id,status:"succeeded",customer:"cus_1",amount:1000,application_fee_amount:null,metadata:metadata("og_throne")}),subscription:async id=>earlySub(),record:async input=>{calls.push(input)},expire:async()=>{}};
const event=(tier:"og_throne"|"early_bird")=>({type:"checkout.session.completed",data:{object:stripeSession(tier)}});
equal(await processPayFirstStripeEvent(event("og_throne"),webhook),"recorded");equal(calls[0].paymentIntentId,"pi_1");equal(calls[0].subscriptionId,null);
calls=[];equal(await processPayFirstStripeEvent(event("early_bird"),webhook),"recorded");equal(calls[0].paymentIntentId,null);equal(calls[0].subscriptionId,"sub_1");

// Migration and Login source contracts.
const migration=readFileSync("supabase/migrations/20260729002200_pay_first_checkout_claims.sql","utf8"),old=readFileSync("supabase/migrations/20260729002100_checkout_capacity_reservations.sql"),login=readFileSync("app/login/page.tsx","utf8");
equal(createHash("sha1").update(`blob ${old.length}\0`).update(old).digest("hex"),"33e05a52b1974fc1257dd0484980ed79dcca5837");
equal(migration.includes("add column stripe_subscription_id text"),true);equal(migration.includes("checkout_capacity_one_stripe_subscription"),true);equal(migration.includes("payment_intent_id=p.payment_intent_id,stripe_subscription_id=p.stripe_subscription_id"),true);equal(migration.includes("payment_intent_id=coalesce"),false);
equal(migration.includes("tier='og_throne' and payment_intent_id is not null and stripe_subscription_id is null"),true);equal(migration.includes("tier='early_bird' and payment_intent_id is null and stripe_subscription_id is not null"),true);
const statusValidation=migration.indexOf("subscription_status_mismatch"),firstMutation=migration.indexOf("update public.profiles",statusValidation);equal(statusValidation>0,true);equal(statusValidation<firstMutation,true);equal(migration.includes("p_subscription_status is not null"),true);equal(migration.includes("p_subscription_status not in ('active','trialing')"),true);equal(migration.includes("p_subscription_status is null"),true);
const transactionalStatus=(tier:"og_throne"|"early_bird",status:string|null)=>{const state={purchase:"paid_unclaimed",reservation:"associated"};if((tier==="og_throne"&&status!==null)||(tier==="early_bird"&&!status)|| (tier==="early_bird"&&!['active','trialing'].includes(status)))throw Object.assign(new Error("subscription_status_mismatch"),{state});state.purchase="claimed";state.reservation="fulfilled";return state};
equal(transactionalStatus("og_throne",null),{purchase:"claimed",reservation:"fulfilled"});equal(transactionalStatus("early_bird","active"),{purchase:"claimed",reservation:"fulfilled"});equal(transactionalStatus("early_bird","trialing"),{purchase:"claimed",reservation:"fulfilled"});
for(const status of [null,"canceled","incomplete","unpaid","arbitrary"]){let error:any;try{transactionalStatus("early_bird",status)}catch(value){error=value}equal(error?.message,"subscription_status_mismatch");equal(error?.state,{purchase:"paid_unclaimed",reservation:"associated"})}

equal(migration.includes("create extension if not exists pg_cron with schema extensions"),true);equal(migration.includes("checkout_guest_rate_limit_attempts"),true);equal(migration.includes("octet_length(network_hash)=32"),true);equal(migration.includes("now()+interval '60 minutes'"),true);equal(migration.includes("hourly>=5"),true);equal(migration.includes("daily>=10"),true);equal(migration.includes("expires_at<=now()"),true);equal(migration.includes("sirens_forge_checkout_guest_rate_limit_cleanup"),true);equal(migration.includes("'17 * * * *'"),true);equal(migration.includes("revoke all on public.checkout_guest_rate_limit_attempts from public,anon,authenticated"),true);equal(migration.includes("acquire_guest_checkout_capacity_reservation(bytea,bytea,text)"),true);
equal((migration.match(/security definer/g)||[]).length,6);equal((migration.match(/search_path = public, pg_temp/g)||[]).length,6);equal(migration.includes("revoke all on public.pay_first_purchases from public,anon,authenticated"),true);equal(migration.includes("to service_role"),true);
equal(login.includes('initialAuthenticationMode(searchParams.get("mode"))'),true);equal(login.includes("authenticationDestination(intent)"),true);
console.log(`payFirstCheckoutClaim: ${assertions} assertions passed`);
