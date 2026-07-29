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
const stripeSession=(tier:"og_throne"|"early_bird"="og_throne")=>({id:sessionId,status:"complete",payment_status:"paid",mode:tier==="og_throne"?"payment":"subscription",customer:"cus_1",payment_intent:tier==="og_throne"?"pi_1":null,subscription:tier==="early_bird"?"sub_1":null,line_items:{data:[{price:{id:tier==="og_throne"?"price_og":"price_early"},quantity:1}]},metadata:metadata(tier)});
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

// Webhook finality resolves the reservation's stored Session and converges all OG success events.
let calls:any[]=[],expires:any[]=[],existing:any=null,storedReservation:any=reservation,storedSession:any=stripeSession(),storedPi:any={id:"pi_1",status:"succeeded",customer:"cus_1",amount:1000,application_fee_amount:null,metadata:metadata("og_throne")};
const webhook=():PayFirstWebhookDependencies=>({ogPriceId:"price_og",earlyPriceId:"price_early",reservation:async()=>storedReservation,purchase:async()=>existing,session:async id=>{calls.push(["session",id]);return storedSession},paymentIntent:async id=>{calls.push(["pi",id]);return storedPi},subscription:async()=>earlySub(),record:async input=>{calls.push(["record",input]);existing={...purchase,...input,purchaser_token_hash:reservation.purchaser_token_hash,stripe_session_id:input.sessionId,stripe_customer_id:input.customerId,stripe_price_id:input.priceId,payment_intent_id:input.paymentIntentId,stripe_subscription_id:input.subscriptionId}},expire:async input=>{expires.push(input)}});
const completed=(change:any={})=>({type:"checkout.session.completed",data:{object:{...stripeSession(),...change}}}),asyncSuccess=(change:any={})=>({type:"checkout.session.async_payment_succeeded",data:{object:{...stripeSession(),...change}}}),piSuccess=(change:any={})=>({type:"payment_intent.succeeded",data:{object:{...storedPi,...change}}});
for(const success of [completed(),asyncSuccess(),piSuccess()]){calls=[];existing=null;equal(await processPayFirstStripeEvent(success,webhook()),"recorded");const recorded=calls.find(x=>x[0]==="record")?.[1];equal(recorded.sessionId,sessionId);equal(recorded.paymentIntentId,"pi_1");equal(calls.some(x=>x[0]==="session"&&x[1]===sessionId),true)}
for(const status of ["unpaid","processing"]){calls=[];existing=null;equal(await processPayFirstStripeEvent(completed({payment_status:status}),webhook()),"ignored");equal(calls.some(x=>x[0]==="record"),false);equal(expires.length,0)}
storedSession={...stripeSession(),payment_status:"processing"};existing=null;equal(await processPayFirstStripeEvent(asyncSuccess(),webhook()),"ignored");equal(await processPayFirstStripeEvent(piSuccess(),webhook()),"recorded");storedSession=stripeSession();
for(const bad of [asyncSuccess({id:"cs_wrong"}),asyncSuccess({customer:"cus_wrong"}),asyncSuccess({payment_intent:"pi_wrong"}),asyncSuccess({metadata:{...metadata("og_throne"),tier_name:"early_bird"}})]){calls=[];existing=null;equal(await processPayFirstStripeEvent(bad,webhook()),"ignored");equal(calls.some(x=>x[0]==="record"),false)}
for(const mutate of [()=>storedSession={...stripeSession(),payment_intent:"pi_wrong"},()=>storedSession={...stripeSession(),line_items:{data:[{price:{id:"price_wrong"},quantity:1}]}},()=>storedSession={...stripeSession(),line_items:{data:[{price:{id:"price_og"},quantity:2}]}},()=>storedPi={...storedPi,customer:"cus_wrong"}]){storedSession=stripeSession();storedPi={id:"pi_1",status:"succeeded",customer:"cus_1",amount:1000,application_fee_amount:null,metadata:metadata("og_throne")};mutate();calls=[];existing=null;equal(await processPayFirstStripeEvent(piSuccess(),webhook()),"ignored")}
storedSession=stripeSession();for(const status of ["processing","requires_action","canceled","failed"]){storedPi={id:"pi_1",status,customer:"cus_1",amount:1000,metadata:metadata("og_throne")};equal(await processPayFirstStripeEvent(piSuccess({status}),webhook()),"ignored")}
storedPi={id:"pi_1",status:"succeeded",customer:"cus_1",amount:1000,application_fee_amount:null,metadata:metadata("og_throne")};storedSession=stripeSession();existing=null;calls=[];equal(await processPayFirstStripeEvent(completed(),webhook()),"recorded");const recordsAfterFirst=calls.filter(x=>x[0]==="record").length;equal(await processPayFirstStripeEvent(piSuccess(),webhook()),"recorded");equal(calls.filter(x=>x[0]==="record").length,recordsAfterFirst);
existing={...purchase,state:"claimed"};storedReservation={...reservation,status:"fulfilled",purchaser_token_hash:null};const claimedRecordCount=calls.filter(x=>x[0]==="record").length;equal(await processPayFirstStripeEvent(piSuccess(),webhook()),"recorded");equal(calls.filter(x=>x[0]==="record").length,claimedRecordCount);storedReservation=reservation;
for(const order of [[piSuccess(),asyncSuccess()],[asyncSuccess(),piSuccess()]] as const){existing=null;calls=[];for(const success of order)equal(await processPayFirstStripeEvent(success,webhook()),"recorded");equal(calls.filter(x=>x[0]==="record").length,1)}
for(const conflict of [{payment_intent_id:"pi_conflict"},{stripe_session_id:"cs_conflict"},{stripe_customer_id:"cus_conflict"},{stripe_price_id:"price_conflict"}]){existing={...purchase,...conflict};await assert.rejects(processPayFirstStripeEvent(piSuccess(),webhook()),/purchase_replay_conflict/);assertions++}
const connectMd={...metadata("og_throne"),connect_mode:"destination_charge",connect_destination_account:"acct_1",connect_onboarded:"true",platform_fee_percent:"80",commission_percent:"20"};storedSession={...stripeSession(),metadata:connectMd};storedPi={id:"pi_1",status:"succeeded",customer:"cus_1",amount:1000,application_fee_amount:800,transfer_data:{destination:"acct_1"},metadata:connectMd};existing=null;equal(await processPayFirstStripeEvent(asyncSuccess({metadata:connectMd}),webhook()),"recorded");
for(const change of [{application_fee_amount:799},{transfer_data:{destination:"acct_wrong"}}]){existing=null;storedPi={...storedPi,...change};equal(await processPayFirstStripeEvent(asyncSuccess({metadata:connectMd}),webhook()),"ignored")}
storedSession=stripeSession();storedPi={id:"pi_1",status:"succeeded",customer:"cus_1",amount:1000,application_fee_amount:null,metadata:metadata("og_throne")};
existing=null;calls=[];equal(await processPayFirstStripeEvent({type:"payment_intent.payment_failed",data:{object:{...storedPi,status:"requires_payment_method"}}},webhook()),"ignored");equal(expires.length,0);equal(await processPayFirstStripeEvent({type:"checkout.session.async_payment_failed",data:{object:stripeSession()}},webhook()),"ignored");equal(expires.length,0);
equal(await processPayFirstStripeEvent(piSuccess(),webhook()),"recorded");
existing=null;expires=[];storedSession={...stripeSession(),payment_status:"unpaid"};equal(await processPayFirstStripeEvent({type:"payment_intent.canceled",data:{object:{...storedPi,status:"canceled"}}},webhook()),"expired");equal(expires.length,1);existing=purchase;equal(await processPayFirstStripeEvent({type:"payment_intent.canceled",data:{object:{...storedPi,status:"canceled"}}},webhook()),"ignored");equal(expires.length,1);
// Early Bird remains on the existing completed subscription path.
existing=null;calls=[];equal(await processPayFirstStripeEvent({type:"checkout.session.completed",data:{object:stripeSession("early_bird")}},webhook()),"recorded");equal(calls.find(x=>x[0]==="record")?.[1].subscriptionId,"sub_1");

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
