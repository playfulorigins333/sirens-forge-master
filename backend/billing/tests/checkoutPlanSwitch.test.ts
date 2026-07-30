import assert from "node:assert/strict";
import { createCheckoutHandler, type CheckoutDependencies } from "../../../app/api/checkout/subscription/route";
import { PURCHASER_COOKIE } from "../../../lib/billing/payFirstCheckout";

let assertions=0;
const equal=(actual:unknown,expected:unknown)=>{assert.deepEqual(actual,expected);assertions++};
const token="A".repeat(43);
const oldReservation="11111111-1111-4111-8111-111111111111";
const newReservation="22222222-2222-4222-8222-222222222222";
const request=(tierName:"og_throne"|"early_bird")=>new Request("https://sirens.test/api/checkout/subscription",{method:"POST",headers:{"content-type":"application/json",cookie:`${PURCHASER_COOKIE}=${token}`},body:JSON.stringify({tierName})});

type State={reserveCalls:number;releaseCalls:number;expireAssociatedCalls:number;expireSessionCalls:number;createCalls:number;retrieved:string[];input:any|null};
const scenario=(status:"active"|"associated",sessionStatus:"open"|"expired"|"complete"|null,conflictTier:"og_throne"|"early_bird"="early_bird")=>{
 const state:State={reserveCalls:0,releaseCalls:0,expireAssociatedCalls:0,expireSessionCalls:0,createCalls:0,retrieved:[],input:null};
 const db={
  tier:async()=>({is_active:true}),
  reserve:async()=>{state.reserveCalls++;if(state.reserveCalls===1){const error:any=new Error("reservation_conflict");error.code="reservation_conflict";throw error}return{reservation_id:newReservation,expires_at:new Date(Date.now()+3_599_000).toISOString(),stripe_session_id:null}},
  conflicting:async()=>({id:oldReservation,tier:conflictTier,status,stripe_session_id:status==="associated"?"cs_old12345678":null}),
  release:async()=>{state.releaseCalls++},
  expireAssociated:async()=>{state.expireAssociatedCalls++},
  associate:async()=>{},
  referral:async()=>({code:null,affiliateUserId:null,commissionPercent:0,destination:null,connectOnboarded:false,payable:false}),
 };
 const deps:CheckoutDependencies={
  enabled:()=>true,
  preflight:()=>({priceId:"price_og",baseUrl:"https://sirens.test",networkHash:"b".repeat(64)}),
  privileged:async()=>db,
  retrievePrice:async()=>({unitAmount:133300}),
  createSession:async(input)=>{state.createCalls++;state.input=input;return{id:"cs_new12345678",url:"https://checkout.stripe.com/pay/new"}},
  retrieveSession:async(id)=>{state.retrieved.push(id);return{id,url:"https://checkout.stripe.com/pay/old",status:sessionStatus}},
  expireSession:async()=>{state.expireSessionCalls++},
  generateToken:()=>token,
 };
 return{state,deps};
};

{
 const{state,deps}=scenario("associated","open");
 const response=await createCheckoutHandler(deps)(request("og_throne"));
 equal(response.status,200);
 equal((await response.json()).url,"https://checkout.stripe.com/pay/new");
 equal(state.reserveCalls,2);
 equal(state.expireSessionCalls,1);
 equal(state.expireAssociatedCalls,1);
 equal(state.releaseCalls,0);
 equal(state.createCalls,1);
 equal(state.retrieved,["cs_old12345678"]);
 equal(state.input.mode,"payment");
 equal(state.input.line_items,[{price:"price_og",quantity:1}]);
}

{
 const{state,deps}=scenario("associated","expired");
 const response=await createCheckoutHandler(deps)(request("og_throne"));
 equal(response.status,200);
 equal(state.reserveCalls,2);
 equal(state.expireSessionCalls,0);
 equal(state.expireAssociatedCalls,1);
 equal(state.createCalls,1);
}

{
 const{state,deps}=scenario("active",null);
 const response=await createCheckoutHandler(deps)(request("og_throne"));
 equal(response.status,200);
 equal(state.reserveCalls,2);
 equal(state.releaseCalls,1);
 equal(state.expireSessionCalls,0);
 equal(state.expireAssociatedCalls,0);
 equal(state.createCalls,1);
}

{
 const{state,deps}=scenario("associated","complete");
 const response=await createCheckoutHandler(deps)(request("og_throne"));
 equal(response.status,409);
 equal(state.reserveCalls,1);
 equal(state.expireSessionCalls,0);
 equal(state.expireAssociatedCalls,0);
 equal(state.createCalls,0);
}

{
 const{state,deps}=scenario("associated","open","og_throne");
 const response=await createCheckoutHandler(deps)(request("og_throne"));
 equal(response.status,409);
 equal(state.reserveCalls,1);
 equal(state.expireSessionCalls,0);
 equal(state.expireAssociatedCalls,0);
 equal(state.createCalls,0);
}

console.log(`checkoutPlanSwitch: ${assertions} assertions passed`);
