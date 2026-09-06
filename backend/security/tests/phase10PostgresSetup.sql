\set ON_ERROR_STOP on
\ir phase8GovernanceFoundationPostgresSetup.sql

-- Minimal Supabase auth.uid() contract for disposable PostgreSQL integration.
create or replace function auth.uid() returns uuid
language sql stable
set search_path=pg_catalog
as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
revoke all on function auth.uid() from public,anon,service_role;
grant execute on function auth.uid() to authenticated;
