import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const databaseUrl=process.env.GUEST_CHECKOUT_RESERVATION_DATABASE_URL;
const postgrestCommand=process.env.POSTGREST_COMMAND||"postgrest";
if(!databaseUrl)throw new Error("GUEST_CHECKOUT_RESERVATION_DATABASE_URL is required");
const url=new URL(databaseUrl);
if(!new Set(["127.0.0.1","localhost","[::1]"]).has(url.hostname)||url.port!=="5432"||url.pathname!=="/guest_checkout_reservation_test")throw new Error("disposable-local-database safety boundary rejected URL");
const setup=spawnSync(process.execPath,["backend/billing/tests/runGuestCheckoutReservationPostgresIntegration.mjs"],{stdio:"inherit",env:process.env});
if(setup.status!==0)process.exit(setup.status??1);
const password="postgrest_test_password",secret="postgrest-integration-secret-32-bytes-minimum";
const sql=`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login password '${password}'; else alter role authenticator login password '${password}'; end if; end $$; grant service_role to authenticator; grant usage on schema public to service_role; truncate public.checkout_guest_rate_limit_attempts,public.checkout_capacity_reservations restart identity cascade; delete from public.user_subscriptions; delete from public.subscription_tiers; insert into public.subscription_tiers(name,is_active,max_slots) values ('early_bird',true,100),('og_throne',true,100);`;
const reset=spawnSync("psql",[databaseUrl,"-X","-v","ON_ERROR_STOP=1","-c",sql],{stdio:"inherit"});if(reset.status!==0)process.exit(reset.status??1);
const dbUri=`postgres://authenticator:${password}@127.0.0.1:5432/guest_checkout_reservation_test`;
const server=spawn(postgrestCommand,{stdio:["ignore","pipe","pipe"],env:{...process.env,PGRST_DB_URI:dbUri,PGRST_DB_SCHEMAS:"public",PGRST_DB_ANON_ROLE:"anon",PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:"127.0.0.1",PGRST_SERVER_PORT:"3100"}});
let logs="";server.stdout.on("data",d=>logs+=d);server.stderr.on("data",d=>logs+=d);
const base64url=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
const unsigned=`${base64url({alg:"HS256",typ:"JWT"})}.${base64url({role:"service_role",exp:Math.floor(Date.now()/1000)+300})}`;
const token=`${unsigned}.${createHmac("sha256",secret).update(unsigned).digest("base64url")}`;
const call=async(tier)=>fetch("http://127.0.0.1:3100/rpc/acquire_guest_checkout_capacity_reservation",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({p_purchaser_token_hash:"\\x"+"01".repeat(32),p_network_hash:"\\x"+"02".repeat(32),p_tier:tier})});
let startupError=null;server.on("error",error=>{startupError=error;logs+=`${error.message}\n`});
const sanitizedLogs=()=>[databaseUrl,dbUri,password,secret,token].reduce((value,sensitive)=>value.replaceAll(sensitive,"[REDACTED]"),logs).replaceAll(/postgres(?:ql)?:\/\/[^\s]+/g,"postgres://[REDACTED]").trim()||"(no PostgREST logs captured)";
const waitForPostgrest=async()=>{
 const deadline=Date.now()+15_000;
 while(Date.now()<deadline){
  if(startupError||server.exitCode!==null)throw new Error(`PostgREST exited before readiness.\n${sanitizedLogs()}`);
  try{
   const response=await fetch("http://127.0.0.1:3100/",{headers:{authorization:`Bearer ${token}`}});
   if(response.status===200)return;
   const body=await response.json().catch(()=>null);
   if(response.status!==503||body?.code!=="PGRST002")throw new Error(`Unexpected PostgREST readiness response: HTTP ${response.status}.\n${sanitizedLogs()}`);
  }catch(error){if(error instanceof Error&&error.message.startsWith("Unexpected PostgREST"))throw error;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error(`Timed out after 15 seconds waiting for PostgREST readiness.\n${sanitizedLogs()}`);
};
try{
 await waitForPostgrest();
 const first=await call("early_bird");if(first.status!==200)throw new Error(`first RPC failed: ${first.status} ${await first.text()}`);const rows=await first.json();assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),["expires_at","reservation_id","stripe_session_id"]);assert.equal(rows[0].stripe_session_id,null);
 const retry=await call("early_bird");if(retry.status!==200)throw new Error(`retry RPC failed: ${retry.status} ${await retry.text()}`);const retried=await retry.json();assert.equal(retried[0].reservation_id,rows[0].reservation_id);
 const conflict=await call("og_throne");assert.equal(conflict.status,400);assert.match(await conflict.text(),/reservation_conflict/);
 const proof=spawnSync("psql",[databaseUrl,"-AtX","-c","select (select count(*) from public.checkout_capacity_reservations)::text||','||(select count(*) from public.checkout_guest_rate_limit_attempts)::text"],{encoding:"utf8"});assert.equal(proof.status,0,proof.stderr);assert.equal(proof.stdout.trim(),"1,1");
 console.log("POSTGREST_GUEST_CHECKOUT_ASSERTIONS_PASSED=10");
}finally{server.kill("SIGTERM");await new Promise(resolve=>{server.once("exit",resolve);setTimeout(resolve,2000)});if(server.exitCode&&server.exitCode!==0)console.error(logs)}
