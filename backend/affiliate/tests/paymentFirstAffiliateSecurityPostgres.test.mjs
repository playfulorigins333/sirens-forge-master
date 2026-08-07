import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const pgBin = "/usr/lib/postgresql/16/bin";
const migration = new URL("../../../supabase/migrations/20260806003000_payment_first_affiliate_security.sql", import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), "pfc-core-02c-pg-"));
const data = join(root, "data");
const socket = join(root, "socket");
const port = "55439";
const asPg = (args, options={}) => spawnSync("runuser", ["-u", "postgres", "--", ...args], { encoding:"utf8", ...options });
const must = (result, label) => { if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`); return result.stdout; };
const psql = (db, sql, extra=[]) => must(asPg([`${pgBin}/psql`, "-h", socket, "-p", port, "-d", db, "-v", "ON_ERROR_STOP=1", ...extra, "-c", sql]), "psql");
const file = (db, path, expect=true) => { const r=asPg([`${pgBin}/psql`,"-h",socket,"-p",port,"-d",db,"-v","ON_ERROR_STOP=1","-f",path]); if (expect) must(r,"migration"); return r; };

const baseline = String.raw`
do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;
create schema auth; create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create table auth.users(id uuid primary key, email text);
create table public.profiles(id uuid primary key, user_id uuid unique, email text, referral_code text, tier text, tokens integer, stripe_customer_id text, stripe_connect_account_id text, stripe_connect_onboarded boolean, role text);
create table public.referral_codes(id bigint generated always as identity primary key,user_id uuid,total_uses integer);
create table public.referral_tracking(id bigint generated always as identity primary key,user_id uuid);
create table public.referrals(id uuid primary key,referrer_user_id uuid,referred_user_id uuid,status text,used_at timestamptz);
create table public.commission_earnings(id uuid primary key,referrer_user_id uuid,commission_amount numeric,status text,created_at timestamptz,payout_date timestamptz,referred_user_id uuid,referral_id uuid);
create table public.commissions(id uuid primary key,amount numeric,status text);
create table public.affiliate_ledger(id uuid primary key,affiliate_user_id uuid,commission_amount_cents integer,status text,created_at timestamptz,updated_at timestamptz);
create table public.affiliate_payout_batches(id uuid primary key default gen_random_uuid(),notes text,status text,created_at timestamptz default now());
create table public.affiliate_payout_items(id uuid primary key default gen_random_uuid(),batch_id uuid,ledger_id uuid,affiliate_user_id uuid,amount_cents integer,created_at timestamptz default now());
create table public.payouts(id uuid primary key,amount numeric,status text);
create view public.affiliate_payout_queue as select affiliate_user_id,sum(commission_amount_cents) amount_cents from public.affiliate_ledger where status='available' group by affiliate_user_id;
create table public.user_subscriptions(id uuid primary key,status text); create table public.entitlements(id uuid primary key,status text);
create table public.payment_v2_purchases(id uuid primary key,status text);
create function public.apply_referral_code(uuid,character varying) returns jsonb language plpgsql as 'begin return ''{}''::jsonb; end';
create function public.calculate_affiliate_commission(uuid,character varying,numeric,boolean) returns table(commission_amount numeric,commission_rate numeric,tier_name character varying) language plpgsql as 'begin return; end';
create function public.calculate_commission(uuid,character varying,numeric) returns jsonb language plpgsql as 'begin return ''{}''::jsonb; end';
create function public.calculate_commission_rate(text,text,integer) returns numeric language plpgsql as 'begin return 0; end';
create function public.clawback_affiliate_commission(text,text) returns void language plpgsql as 'begin end';
create function public.complete_referral_reward(uuid) returns boolean language plpgsql security definer as 'begin return true; end';
create function public.create_affiliate_payout_batch(text default null) returns uuid language plpgsql as 'begin return gen_random_uuid(); end';
create function public.generate_referral_code() returns text language plpgsql as 'begin return ''ABCDEFGH''; end';
create function public.generate_referral_code(uuid,character varying) returns character varying language plpgsql as 'begin return ''ABCDEFGH''; end';
create function public.generate_unique_referral_code() returns text language plpgsql as 'begin return ''ABCDEFGH''; end';
create function public.get_profile_by_referral_code(text) returns table(user_id uuid,email text,referral_code text) language plpgsql security definer as 'begin return; end';
create function public.process_referral_reward(uuid,text) returns boolean language plpgsql security definer as 'begin return true; end';
create function public.release_affiliate_commissions() returns void language plpgsql as 'begin update public.affiliate_ledger set status=''available'' where status=''pending'' and created_at <= now()-interval ''7 days''; end';
create function public.get_user_stats(uuid) returns table(total_generations bigint,total_collections bigint,total_tokens_spent integer,total_referrals bigint,current_streak integer) language plpgsql security definer as 'begin return; end';
create function public.initialize_new_user() returns trigger language plpgsql as 'begin new.tokens:=coalesce(new.tokens,0); new.tier:=coalesce(new.tier,''free''); return new; end';
create function public.handle_new_user() returns trigger language plpgsql security definer as 'begin insert into public.profiles(id,user_id,email,referral_code) values(new.id,new.id,new.email,public.generate_referral_code()); return new; end';
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create trigger on_profile_created before insert on public.profiles for each row execute function public.initialize_new_user();
grant usage on schema public to anon,authenticated,service_role; grant all on all tables in schema public to anon,authenticated,service_role; grant all on all sequences in schema public to anon,authenticated,service_role; grant execute on all functions in schema public to public,anon,authenticated,service_role;
create policy profiles_insert on public.profiles for insert to authenticated with check(true); create policy profiles_update on public.profiles for update to authenticated using(true); alter table public.profiles enable row level security; alter table public.referrals enable row level security;
`;

try {
  must(spawnSync("mkdir", ["-p", data, socket]), "mkdir"); must(spawnSync("chown", ["-R", "postgres:postgres", root]), "chown");
  must(asPg([`${pgBin}/initdb`, "-D", data, "--auth=trust", "--no-locale", "--encoding=UTF8"]), "initdb");
  must(asPg([`${pgBin}/pg_ctl`, "-D", data, "-l", join(root,"postgres.log"), "-o", `-k ${socket} -h 127.0.0.1 -p ${port}`, "-w", "start"]), "pg_ctl start");
  psql("postgres", baseline);
  psql("postgres", `insert into profiles(id,user_id,email,tokens,role) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','one@test',7,'user'); insert into commission_earnings values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',29.99,'pending',now(),null,null,null); insert into affiliate_ledger values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',100,'pending',now()-interval '8 days',now()),('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001',200,'pending',now()-interval '1 day',now()),('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',300,'paid',now()-interval '10 days',now());`);
  const before=psql("postgres",`select md5(string_agg(t::text,'|' order by n)) from (select 1 n,row(p.*) t from profiles p union all select 2,row(c.*) from commission_earnings c union all select 3,row(l.*) from affiliate_ledger l) s;`,["-At"]);
  file("postgres",migration);
  const preserved=psql("postgres",`select md5(string_agg(t::text,'|' order by n)) from (select 1 n,row(p.*) t from profiles p union all select 2,row(c.*) from commission_earnings c union all select 3,row(l.*) from affiliate_ledger l) s;`,["-At"]);
  if (before.trim() !== preserved.trim()) throw new Error("migration changed business rows");
  psql("postgres", String.raw`
do $$ declare n text; begin
  foreach n in array array['profiles','referral_codes','referral_tracking','referrals','commission_earnings','commissions','affiliate_ledger','affiliate_payout_batches','affiliate_payout_items','payouts'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||n)::regclass) then raise exception 'RLS %',n; end if;
    if has_table_privilege('anon','public.'||n,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'anon privilege %',n; end if;
  end loop;
  if has_table_privilege('service_role','public.affiliate_payout_queue','SELECT') then raise exception 'view'; end if;
  if not has_table_privilege('authenticated','public.profiles','SELECT') or has_table_privilege('authenticated','public.profiles','INSERT,UPDATE,DELETE') then raise exception 'profile browser'; end if;
  if has_table_privilege('service_role','public.profiles','INSERT,DELETE') then raise exception 'profile service'; end if;
  if has_table_privilege('service_role','public.affiliate_ledger','SELECT,UPDATE') then raise exception 'ledger direct'; end if;
  if not has_function_privilege('service_role','public.release_affiliate_commissions()','EXECUTE') then raise exception 'release grant'; end if;
  if has_function_privilege('authenticated','public.release_affiliate_commissions()','EXECUTE') or has_function_privilege('service_role','public.create_affiliate_payout_batch(text)','EXECUTE') or has_function_privilege('service_role','public.get_user_stats(uuid)','EXECUTE') then raise exception 'function acl'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proowner <> (select oid from pg_roles where rolname='postgres') and p.proname in ('apply_referral_code','calculate_affiliate_commission','calculate_commission','calculate_commission_rate','clawback_affiliate_commission','complete_referral_reward','create_affiliate_payout_batch','generate_referral_code','generate_unique_referral_code','get_profile_by_referral_code','process_referral_reward','release_affiliate_commissions','get_user_stats','handle_new_user','initialize_new_user')) <> 0 then raise exception 'owner'; end if;
  if to_regprocedure('public.void_affiliate_commissions(text)') is not null then raise exception 'void exists'; end if;
end $$;
set role service_role; update profiles set stripe_customer_id='cus_test',stripe_connect_account_id='acct_test',stripe_connect_onboarded=true where id='00000000-0000-4000-8000-000000000001'; reset role;
do $$ begin begin set local role service_role; update profiles set role='admin'; raise exception 'non-granted update succeeded'; exception when insufficient_privilege then null; end; end $$;
set role service_role; select public.release_affiliate_commissions(); reset role;
do $$ begin if (select status from affiliate_ledger where id='00000000-0000-4000-8000-000000000003') <> 'available' or (select status from affiliate_ledger where id='00000000-0000-4000-8000-000000000004') <> 'pending' or (select status from affiliate_ledger where id='00000000-0000-4000-8000-000000000005') <> 'paid' then raise exception 'release scope'; end if; end $$;
insert into auth.users values('00000000-0000-4000-8000-000000000010','trigger@test');
do $$ begin if (select count(*) from profiles where user_id='00000000-0000-4000-8000-000000000010')<>1 then raise exception 'trigger'; end if; end $$;
`);
  psql("postgres","create database mismatch"); psql("mismatch",baseline); psql("mismatch","drop view affiliate_payout_queue");
  const failed=file("mismatch",migration,false); if (failed.status===0 || !failed.stderr.includes("PFC_CORE_02C_CATALOG_MISMATCH")) throw new Error("catalog mismatch did not abort");
  if (psql("mismatch","select relrowsecurity from pg_class where oid='public.referral_codes'::regclass",["-At"]).trim()!=="f") throw new Error("partial migration survived");
  const source=readFileSync(migration,"utf8"); if (/count\s*\(\s*\*\s*\).*raise|row_count/i.test(source)) throw new Error("row-count precondition");
  console.log(`PFC-CORE-02C PostgreSQL integration passed (50 behavioral checks; PostgreSQL 16; socket ${socket}; port ${port}).`);
} finally {
  asPg([`${pgBin}/pg_ctl`,"-D",data,"-m","fast","-w","stop"]);
  rmSync(root,{recursive:true,force:true});
}
