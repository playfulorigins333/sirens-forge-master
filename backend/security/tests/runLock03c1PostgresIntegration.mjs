import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.LOCK03C1_DATABASE_URL;
if (!databaseUrl) throw new Error("LOCK03C1_DATABASE_URL is required; no database was contacted");
const url = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== "5432" || url.pathname !== "/lock03c1_test" || url.search || url.hash) {
  throw new Error("LOCK03C1 safety boundary rejected non-local or unexpected database URL");
}
const migration = readFileSync("supabase/migrations/20260810003400_lock03c1_public_table_rls_boundary.sql", "utf8");
const rollback = readFileSync("supabase/manual/lock03c1_public_table_rls_rollback.sql", "utf8");
const targets = `lora_status_events sf_users models model_enrollments platform_connections approved_media posting_rules scheduled_posts post_logs campaign_links caption_templates hashtag_sets cta_variants content_generation_jobs content_usage_log autopost_settings autopost_runs autopost_run_results pfc03000_backup_profiles pfc03000_backup_referral_codes pfc03000_backup_referral_tracking pfc03000_backup_referrals pfc03000_backup_commission_earnings pfc03000_backup_commissions pfc03000_backup_affiliate_ledger pfc03000_backup_affiliate_payout_batches pfc03000_backup_affiliate_payout_items pfc03000_backup_payouts pfc03000_backup_catalog_snapshot`.split(" ");
const q = (name) => `"${name}"`;
function psql(sql, expectSuccess = true) {
  const result = spawnSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
  if ((result.status === 0) !== expectSuccess) throw new Error(`psql expectation failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
}
function fixture() {
  return `
    drop schema public cascade; create schema public;
    do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; else alter role service_role bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    ${targets.map((t) => `create table public.${q(t)} (id integer primary key, marker text not null); insert into public.${q(t)} values (1, 'original'); grant select, insert, update, delete on public.${q(t)} to anon, authenticated, service_role;`).join("\n")}
    create table public.unrelated_control (id integer primary key, marker text not null); insert into public.unrelated_control values (1, 'control'); grant all on public.unrelated_control to anon, authenticated, service_role;
    create policy stale_permissive on public.lora_status_events for all to anon, authenticated using (true) with check (true);
  `;
}
psql(fixture() + migration);
for (const role of ["anon", "authenticated"]) {
  psql(`
    set role ${role};
    select 1 / (case when count(*) = 0 then 1 else 0 end)
      from public.lora_status_events;

    do $lock03c1_denial$
    declare
      affected bigint;
      insert_denied boolean := false;
    begin
      begin
        insert into public.lora_status_events values (2, 'bad');
      exception
        when sqlstate '42501' then
          insert_denied := true;
      end;

      if not insert_denied then
        raise exception 'LOCK03C1_EXPECTED_INSERT_DENIAL_MISSING';
      end if;

      update public.lora_status_events set marker = 'bad' where id = 1;
      get diagnostics affected = row_count;
      if affected <> 0 then
        raise exception 'LOCK03C1_UPDATE_NOT_DENIED';
      end if;

      delete from public.lora_status_events where id = 1;
      get diagnostics affected = row_count;
      if affected <> 0 then
        raise exception 'LOCK03C1_DELETE_NOT_DENIED';
      end if;
    end
    $lock03c1_denial$;
    reset role;
  `);
}
// Catalog and data invariants, including all 29 unchanged rows and the unrelated table.
psql(`do $$ declare t text; n bigint; begin foreach t in array array[${targets.map((t) => `'${t}'`).join(",")}] loop execute format('select count(*) from public.%I where id=1 and marker=''original''',t) into n; if n<>1 then raise exception 'data changed %',t; end if; end loop; if (select marker from public.unrelated_control where id=1)<>'control' then raise exception 'control changed'; end if; end $$; set role service_role; select * from public.lora_status_events; insert into public.lora_status_events values (2,'service'); update public.lora_status_events set marker='service-updated' where id=2; delete from public.lora_status_events where id=2;`);
// Fresh audited state for the source-only rollback exercise.
psql(fixture() + migration + rollback + `do $$ declare n integer; begin select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname=any(array[${targets.map((t) => `'${t}'`).join(",")}]) and not c.relrowsecurity; if n<>29 then raise exception 'rollback did not disable all targets'; end if; if (select marker from public.unrelated_control where id=1)<>'control' then raise exception 'rollback changed control'; end if; end $$;`);
console.log("LOCK-03C1 disposable PostgreSQL integration passed");
