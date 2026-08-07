import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sql = readFileSync("supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql", "utf8")
let assertions = 0
const has = (pattern: RegExp, message: string) => { assert.match(sql, pattern, message); assertions++ }
const lacks = (pattern: RegExp, message: string) => { assert.doesNotMatch(sql, pattern, message); assertions++ }

for (const column of ["referral_code_id", "referrer_auth_user_id", "referrer_profile_id", "referrer_affiliate_tier", "referral_bound_at"]) has(new RegExp(`add column ${column}\\b`, "i"), `immutable tuple includes ${column}`)
has(/payment_v2_holds[\s\S]*add column referral_code_id uuid references public\.referral_codes\(id\)/i, "hold referral binding uses Production UUID")
has(/payment_v2_purchases[\s\S]*add column referral_code_id uuid references public\.referral_codes\(id\)/i, "purchase referral binding uses Production UUID")
has(/affiliate_ledger[\s\S]*add column referral_code_id uuid references public\.referral_codes\(id\)/i, "ledger referral binding uses Production UUID")
has(/add column referrer_auth_user_id uuid references auth\.users\(id\)/i, "auth-user namespace has its own foreign key")
has(/add column referrer_profile_id uuid references public\.profiles\(id\)/i, "profile namespace has its own foreign key")
for (const state of ["PURCHASER_UNCLAIMED", "PURCHASER_ATTACHED", "VOID_SELF_REFERRAL"]) has(new RegExp(state), `attribution state ${state} is locked`)
for (const event of ["AFFILIATE_OBLIGATION_CREATED", "AFFILIATE_PURCHASER_ATTACHED", "AFFILIATE_SELF_REFERRAL_VOIDED"]) has(new RegExp(event), `internal evidence ${event} exists`)
has(/upper\(p_referral_code\).*\^\[A-Z0-9_-\]\{4,20\}\$/s, "database normalizes and syntax checks codes")
has(/user_subscriptions s where s\.user_id=profile\.id/s, "affiliate entitlement lookup is profile keyed")
has(/case when h\.tier='og_throne'.*then 25.*then 10.*then 50.*else 20 end/s, "commission matrix is server locked")
has(/round\(p_gross_amount_cents\*rate\/100\.0\)/, "commission cents use deterministic normal rounding")
has(/stripe_event_id,stripe_subscription_id,tier_name[\s\S]*p_provider_event_id,p_subscription_id,h\.tier/, "ledger insert supplies authoritative event, subscription, and purchase tier")
has(/if found then[\s\S]*h\.referral_code_id is distinct from submitted_referral_id[\s\S]*h\.stripe_connect_destination,rate; return;[\s\S]*status='active'/, "existing hold returns stored snapshots before current entitlement eligibility is evaluated")
has(/drop function public\.payment_v2_acquire_hold\(bytea,text,timestamptz\)/, "obsolete hold overload is removed")
has(/drop function public\.payment_v2_record_paid\(uuid,bytea,text,text,text,text,text,text,timestamptz\)/, "obsolete paid overload is removed")
has(/payment_v2_purchase_id is null or \(l\.attribution_status='PURCHASER_ATTACHED' and l\.referred_user_id is not null\)/, "payout retains legacy rows and gates V2 rows")
has(/where id=any\(coalesce\(inserted_ids,array\[\]::uuid\[\]\)\)/, "only inserted payout ledger IDs become paid")
has(/security invoker set search_path=pg_catalog,pg_temp/, "payout remains invoker with safe search path")
lacks(/grant execute on function public\.create_affiliate_payout_batch\(text\) to service_role/i, "payout execute is not granted to service role")
lacks(/referral_codes set total_uses|insert into public\.(referrals|commission_earnings)/i, "hold/paid path does not mutate legacy referral counters or duplicate earnings")

console.log(`PFC-CORE-03B affiliate attribution source contract passed (${assertions} assertions).`)
