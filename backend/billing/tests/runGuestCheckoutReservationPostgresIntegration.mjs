import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const databaseUrl = process.env.GUEST_CHECKOUT_RESERVATION_DATABASE_URL;
const diagnosticsPath = "/tmp/guest-checkout-reservation-postgres-diagnostics.log";
const migrationPaths = ["supabase/migrations/20260729002300_fix_guest_checkout_reservation_ambiguity.sql", "supabase/migrations/20260730002400_safe_guest_checkout_plan_switch.sql"];

writeFileSync(diagnosticsPath, `Guest checkout reservation PostgreSQL diagnostics\nstarted_at=${new Date().toISOString()}\n`);

if (!databaseUrl) {
  appendFileSync(diagnosticsPath, "FAILED: GUEST_CHECKOUT_RESERVATION_DATABASE_URL is required\n");
  console.error("GUEST_CHECKOUT_RESERVATION_DATABASE_URL is required; no database was contacted.");
  process.exit(1);
}

const url = new URL(databaseUrl);
if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) ||
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) ||
    url.port !== "5432" || url.pathname !== "/guest_checkout_reservation_test" || url.search || url.hash) {
  appendFileSync(diagnosticsPath, "FAILED: disposable-local-database safety boundary rejected URL\n");
  console.error("Use only the local PostgreSQL database guest_checkout_reservation_test on port 5432.");
  process.exit(1);
}

const bootstrap = String.raw`
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
drop schema if exists public cascade;
create schema public;

create table public.subscription_tiers (
 id uuid primary key default gen_random_uuid(), name text not null unique,
 stripe_price_id text, is_active boolean not null default true, max_slots integer
);
create table public.user_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 tier_id uuid references public.subscription_tiers(id), tier_name text not null,
 stripe_customer_id text, stripe_subscription_id text,
 status text not null, metadata jsonb not null default '{}'::jsonb
);
create table public.checkout_capacity_reservations (
 id uuid primary key default gen_random_uuid(), profile_id uuid,
 purchaser_token_hash bytea, tier text not null check (tier in ('og_throne','early_bird')),
 status text not null default 'active' check (status in ('active','associated','fulfilled','released','expired')),
 expires_at timestamptz not null, stripe_session_id text, payment_intent_id text,
 stripe_subscription_id text, fulfilled_at timestamptz,
 idempotency_identity uuid not null default gen_random_uuid() unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint checkout_capacity_exactly_one_owner check ((profile_id is not null)::integer + (purchaser_token_hash is not null)::integer = 1),
 constraint checkout_capacity_token_hash_length check (purchaser_token_hash is null or octet_length(purchaser_token_hash)=32)
);
create unique index checkout_capacity_one_effective_guest on public.checkout_capacity_reservations(purchaser_token_hash) where purchaser_token_hash is not null and status in ('active','associated');
create index checkout_capacity_reservations_capacity_idx on public.checkout_capacity_reservations(tier,status,expires_at);
create table public.checkout_guest_rate_limit_attempts (
 id uuid primary key default gen_random_uuid(), network_hash bytea not null check (octet_length(network_hash)=32),
 purchaser_token_hash bytea not null check (octet_length(purchaser_token_hash)=32),
 reservation_id uuid not null unique references public.checkout_capacity_reservations(id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '24 hours'),
 check (expires_at>created_at and expires_at<=created_at+interval '25 hours')
);
create index checkout_guest_rate_limit_network_created_idx on public.checkout_guest_rate_limit_attempts(network_hash,created_at);
`;

const assertions = String.raw`
create temp table assertion_counter (value integer not null);
insert into assertion_counter values (0);
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'assertion_failed: %',label; end if; update assertion_counter set value=value+1; end $$;

select pg_temp.assert_true(to_regprocedure('public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text)') is not null,'signature');
select pg_temp.assert_true((select prosecdef from pg_proc where oid='public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text)'::regprocedure),'security definer');
select pg_temp.assert_true((select proconfig=array['search_path=public, pg_temp'] from pg_proc where oid='public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text)'::regprocedure),'search path');
select pg_temp.assert_true(pg_get_function_result('public.acquire_guest_checkout_capacity_reservation(bytea,bytea,text)'::regprocedure)='TABLE(reservation_id uuid, expires_at timestamp with time zone, stripe_session_id text, reservation_tier text)','return shape');
insert into public.subscription_tiers(name,is_active,max_slots) values ('early_bird',true,100),('og_throne',true,100);
select pg_temp.assert_true((select is_active and max_slots>0 from public.subscription_tiers where name='early_bird'),'active Early Bird');
create temp table first_result as select * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),'early_bird');
select pg_temp.assert_true(true,'acquisition executed without 42702');
select pg_temp.assert_true((select count(*)=1 from first_result),'one result');
select pg_temp.assert_true((select reservation_id is not null and pg_typeof(reservation_id)='uuid'::regtype from first_result),'uuid result');
select pg_temp.assert_true((select pg_typeof(expires_at)='timestamp with time zone'::regtype and expires_at between now()+interval '59 minutes' and now()+interval '61 minutes' from first_result),'expiration result');
select pg_temp.assert_true((select pg_typeof(stripe_session_id)='text'::regtype and stripe_session_id is null and reservation_tier='early_bird' from first_result),'session result');
select pg_temp.assert_true((select r.profile_id is null and r.purchaser_token_hash=decode(repeat('01',32),'hex') and r.tier='early_bird' and r.status='active' and r.stripe_session_id is null and r.expires_at=f.expires_at from public.checkout_capacity_reservations r cross join first_result f where r.id=f.reservation_id),'inserted reservation');
select pg_temp.assert_true((select count(*)=1 from public.checkout_guest_rate_limit_attempts a join first_result f on f.reservation_id=a.reservation_id),'one rate attempt');
select pg_temp.assert_true((select a.network_hash=decode(repeat('02',32),'hex') from public.checkout_guest_rate_limit_attempts a join first_result f on f.reservation_id=a.reservation_id),'exact rate-limit network hash');
select pg_temp.assert_true((select a.expires_at between now()+interval '23 hours 59 minutes' and now()+interval '24 hours 1 minute' from public.checkout_guest_rate_limit_attempts a join first_result f on f.reservation_id=a.reservation_id),'rate-limit expiration');
create temp table reuse_result as select * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),'early_bird');
select pg_temp.assert_true((select r.reservation_id=f.reservation_id from reuse_result r cross join first_result f),'same reservation');
select pg_temp.assert_true((select r.expires_at=f.expires_at from reuse_result r cross join first_result f),'same expiration');
select pg_temp.assert_true((select stripe_session_id is null from reuse_result),'same null session');
select pg_temp.assert_true((select count(*)=1 from public.checkout_capacity_reservations where purchaser_token_hash=decode(repeat('01',32),'hex')),'no duplicate reservation');
select pg_temp.assert_true((select count(*)=1 from public.checkout_guest_rate_limit_attempts where purchaser_token_hash=decode(repeat('01',32),'hex')),'no duplicate attempt');
create temp table switch_offer as select * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),'og_throne');
select pg_temp.assert_true((select reservation_tier='early_bird' and reservation_id=(select reservation_id from first_result) from switch_offer),'cross-tier deterministic offer');
create temp table switch_result as select * from public.switch_guest_checkout_capacity_reservation(decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),'og_throne',(select reservation_id from first_result),null);
select pg_temp.assert_true((select reservation_tier='og_throne' and stripe_session_id is null from switch_result),'early bird to OG switch');
select pg_temp.assert_true((select count(*)=1 from public.checkout_capacity_reservations where purchaser_token_hash=decode(repeat('01',32),'hex') and status in ('active','associated')),'one effective reservation after switch');
select pg_temp.assert_true((select count(*)=2 from public.checkout_guest_rate_limit_attempts where purchaser_token_hash=decode(repeat('01',32),'hex')),'switch counts toward rate limit');
create temp table reverse_result as select * from public.switch_guest_checkout_capacity_reservation(decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),'early_bird',(select reservation_id from switch_result),null);
select pg_temp.assert_true((select reservation_tier='early_bird' from reverse_result),'OG to early bird switch');

do $$ declare i integer; begin for i in 10..14 loop perform * from public.acquire_guest_checkout_capacity_reservation(decode(lpad(to_hex(i),64,'0'),'hex'),decode(repeat('20',32),'hex'),'early_bird'); end loop; end $$;
select pg_temp.assert_true((select count(*)=5 from public.checkout_guest_rate_limit_attempts where network_hash=decode(repeat('20',32),'hex')),'five hourly reservations');
do $$ begin perform * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('21',32),'hex'),decode(repeat('20',32),'hex'),'early_bird'); raise exception 'missing expected error'; exception when others then if sqlerrm<>'rate_limit_hourly' then raise; end if; end $$;
select pg_temp.assert_true(true,'hourly rejection');
select pg_temp.assert_true((select not exists(select 1 from public.checkout_capacity_reservations where purchaser_token_hash=decode(repeat('21',32),'hex')) and not exists(select 1 from public.checkout_guest_rate_limit_attempts where purchaser_token_hash=decode(repeat('21',32),'hex'))),'hourly rejection atomic');

do $$ declare i integer; rid uuid; begin for i in 30..39 loop insert into public.checkout_capacity_reservations(profile_id,purchaser_token_hash,tier,expires_at,status) values(null,decode(lpad(to_hex(i),64,'0'),'hex'),'early_bird',now()-interval '2 hours','expired') returning id into rid; insert into public.checkout_guest_rate_limit_attempts(network_hash,purchaser_token_hash,reservation_id,created_at,expires_at) values(decode(repeat('30',32),'hex'),decode(lpad(to_hex(i),64,'0'),'hex'),rid,now()-interval '2 hours',now()+interval '22 hours'); end loop; end $$;
select pg_temp.assert_true((select count(*)=10 from public.checkout_guest_rate_limit_attempts where network_hash=decode(repeat('30',32),'hex') and created_at<now()-interval '60 minutes' and created_at>now()-interval '24 hours'),'ten daily attempts');
do $$ begin perform * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('31',32),'hex'),decode(repeat('30',32),'hex'),'early_bird'); raise exception 'missing expected error'; exception when others then if sqlerrm<>'rate_limit_daily' then raise; end if; end $$;
select pg_temp.assert_true(true,'daily rejection');
select pg_temp.assert_true((select not exists(select 1 from public.checkout_capacity_reservations where purchaser_token_hash=decode(repeat('31',32),'hex')) and not exists(select 1 from public.checkout_guest_rate_limit_attempts where purchaser_token_hash=decode(repeat('31',32),'hex'))),'daily rejection atomic');

update public.subscription_tiers set max_slots=1 where name='early_bird';
delete from public.checkout_guest_rate_limit_attempts; delete from public.checkout_capacity_reservations;
insert into public.user_subscriptions(user_id,tier_name,status) values(gen_random_uuid(),'early_bird','active');
select pg_temp.assert_true((select max_slots=1 from public.subscription_tiers where name='early_bird'),'small capacity');
select pg_temp.assert_true((select count(*)=1 from public.user_subscriptions where tier_name='early_bird' and status in ('active','trialing')),'capacity filled');
do $$ begin perform * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('41',32),'hex'),decode(repeat('42',32),'hex'),'early_bird'); raise exception 'missing expected error'; exception when others then if sqlerrm<>'sold_out' then raise; end if; end $$;
select pg_temp.assert_true(true,'sold out rejection');
select pg_temp.assert_true((select not exists(select 1 from public.checkout_capacity_reservations where purchaser_token_hash=decode(repeat('41',32),'hex')) and not exists(select 1 from public.checkout_guest_rate_limit_attempts where purchaser_token_hash=decode(repeat('41',32),'hex'))),'sold out atomic');

update public.subscription_tiers set is_active=false where name='early_bird';
select pg_temp.assert_true((select not is_active from public.subscription_tiers where name='early_bird'),'inactive plan fixture');
do $$ begin perform * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('51',32),'hex'),decode(repeat('52',32),'hex'),'early_bird'); raise exception 'missing expected error'; exception when others then if sqlerrm<>'plan_unavailable' then raise; end if; end $$;
select pg_temp.assert_true(true,'plan unavailable rejection');
select pg_temp.assert_true((select not exists(select 1 from public.checkout_capacity_reservations where purchaser_token_hash=decode(repeat('51',32),'hex')) and not exists(select 1 from public.checkout_guest_rate_limit_attempts where purchaser_token_hash=decode(repeat('51',32),'hex'))),'plan unavailable atomic');
do $$ begin perform * from public.acquire_guest_checkout_capacity_reservation(decode('01','hex'),decode(repeat('61',32),'hex'),'early_bird'); raise exception 'missing expected error'; exception when others then if sqlerrm<>'invalid_request' then raise; end if; end $$;
select pg_temp.assert_true(true,'invalid purchaser hash');
do $$ begin perform * from public.acquire_guest_checkout_capacity_reservation(decode(repeat('62',32),'hex'),decode('01','hex'),'early_bird'); raise exception 'missing expected error'; exception when others then if sqlerrm<>'malformed_network_hash' then raise; end if; end $$;
select pg_temp.assert_true(true,'invalid network hash');
select pg_temp.assert_true((select count(*)=1 from first_result),'function executed in PostgreSQL');
do $$ declare total integer; begin select value into total from assertion_counter; if total<>40 then raise exception 'expected 40 assertions, got %',total; end if; raise notice 'GUEST_CHECKOUT_RESERVATION_ASSERTIONS_PASSED=%',total; end $$;
`;

const sql = `${bootstrap}\n${migrationPaths.map((path) => readFileSync(path, "utf8")).join("\n")}\n${assertions}`;
const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
appendFileSync(diagnosticsPath, `postgres_version=${spawnSync("psql", [databaseUrl, "-AtX", "-c", "show server_version"], { encoding: "utf8" }).stdout.trim()}\n${result.stdout}${result.stderr}`);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("GUEST_CHECKOUT_RESERVATION_ASSERTIONS_PASSED=40");
