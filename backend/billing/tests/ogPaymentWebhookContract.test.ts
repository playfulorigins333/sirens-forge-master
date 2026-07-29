import assert from "node:assert/strict";
import { processLaunchStripeEvent, type LaunchWebhookDependencies } from "../../../app/api/webhook/route";
import { LAUNCH_CHECKOUT_CONTRACT } from "../../../lib/billing/launchCheckoutPolicy";
let assertions=0; const equal=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assertions++};
const metadata={checkout_contract:LAUNCH_CHECKOUT_CONTRACT,tier_name:"og_throne",profile_id:"p1",user_id:"u1",reservation_id:"r1",stripe_price_id:"price_og",stripe_customer_id:"cus1",connect_mode:"none",connect_destination_account:""};
let calls:any[]=[]; const deps:LaunchWebhookDependencies={ogPriceId:"price_og",fulfill:async(i)=>{calls.push(["fulfill",i])},expire:async(i)=>{calls.push(["expire",i])}};
const session=(override:any={})=>({type:"checkout.session.completed",data:{object:{id:"cs1",mode:"payment",payment_status:"paid",customer:"cus1",payment_intent:"pi1",metadata:{...metadata},...override}}});
const pi=(override:any={})=>({type:"payment_intent.succeeded",data:{object:{id:"pi1",status:"succeeded",customer:"cus1",metadata:{...metadata},...override}}});
equal(await processLaunchStripeEvent(session(),deps),"fulfilled"); equal(calls.length,1); calls=[];
for(const change of [{payment_status:"unpaid"},{mode:"subscription"},{metadata:{...metadata,checkout_contract:""}},{metadata:{...metadata,checkout_contract:"wrong"}},{metadata:{...metadata,tier_name:"early_bird"}},{metadata:{...metadata,stripe_price_id:"wrong"}},{metadata:{...metadata,profile_id:""}},{metadata:{...metadata,user_id:""}},{metadata:{...metadata,reservation_id:""}},{customer:""},{metadata:{...metadata,stripe_customer_id:"other"}},{payment_intent:""}]) { equal(await processLaunchStripeEvent(session(change),deps),"ignored"); equal(calls.length,0); }
equal(await processLaunchStripeEvent(pi(),deps),"fulfilled"); equal(calls.length,1); calls=[];
for(const status of ["processing","requires_action","requires_payment_method","requires_capture","canceled","failed"]) { equal(await processLaunchStripeEvent(pi({status}),deps),"ignored"); }
for(const event of [{...pi(),type:"payment_intent.processing"},pi({metadata:{...metadata,tier_name:"early_bird"}}),pi({metadata:{...metadata,stripe_price_id:"wrong"}}),pi({customer:"other"}),pi({metadata:{...metadata,reservation_id:""}}),pi({metadata:{...metadata,checkout_contract:""}})]) equal(await processLaunchStripeEvent(event,deps),"ignored");
const connect={...metadata,connect_mode:"destination_charge",connect_destination_account:"acct1"};
equal(await processLaunchStripeEvent(pi({metadata:connect,transfer_data:{destination:"acct1"},application_fee_amount:100}),deps),"fulfilled"); calls=[];
equal(await processLaunchStripeEvent(pi({metadata:connect,transfer_data:{destination:"other"},application_fee_amount:100}),deps),"ignored");
equal(await processLaunchStripeEvent(pi({metadata:{...connect,connect_destination_account:""},transfer_data:{destination:"acct1"},application_fee_amount:100}),deps),"ignored");
equal(await processLaunchStripeEvent(pi(),deps),"fulfilled"); equal((calls[0]?.[1] as any)?.connect_destination_account,undefined); calls=[];
const state={payment:null as string|null,entitlements:0,status:"associated"}; const transactional:LaunchWebhookDependencies={ogPriceId:"price_og",async fulfill(i){if(state.status==="fulfilled"){if(state.payment===i.paymentIntentId)return "already_fulfilled";throw new Error("conflict")}state.payment=i.paymentIntentId;state.status="fulfilled";state.entitlements=1;return "applied"},async expire(i){if(i.reservationId!=="r1"||i.profileId!=="p1"||i.sessionId!=="cs1")throw new Error("mismatch");if(state.status!=="associated")throw new Error("conflict");state.status="expired"}};
equal(await processLaunchStripeEvent(session(),transactional),"fulfilled"); equal(state.entitlements,1); equal(await processLaunchStripeEvent(pi(),transactional),"fulfilled"); equal(state.entitlements,1); await assert.rejects(processLaunchStripeEvent(pi({id:"pi2"}),transactional));assertions++;
const expiration=(tier:string="og_throne",override:any={})=>({type:"checkout.session.expired",data:{object:{id:"cs1",metadata:{...metadata,tier_name:tier,...override}}}});
state.status="associated"; equal(await processLaunchStripeEvent(expiration(),transactional),"expired"); equal(state.status,"expired");
state.status="associated"; equal(await processLaunchStripeEvent(expiration("early_bird"),transactional),"expired");
for(const event of [expiration("prime_access"),expiration("og_throne",{reservation_id:""}),expiration("og_throne",{profile_id:""}),expiration("og_throne",{checkout_contract:""}),{type:"unknown",data:{object:{}}}]) equal(await processLaunchStripeEvent(event,transactional),"ignored");
for(const event of [expiration("og_throne",{reservation_id:"other"}),expiration("og_throne",{profile_id:"other"}),{...expiration(),data:{object:{...expiration().data.object,id:"cs_other"}}}]) {state.status="associated";await assert.rejects(processLaunchStripeEvent(event,transactional));assertions++;equal(state.status,"associated")}
state.status="fulfilled"; await assert.rejects(processLaunchStripeEvent(expiration(),transactional));assertions++; equal(state.status,"fulfilled");
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error("network forbidden")};equal(typeof globalThis.fetch,"function");globalThis.fetch=originalFetch;
console.log(`ogPaymentWebhookContract: ${assertions} assertions passed`);
