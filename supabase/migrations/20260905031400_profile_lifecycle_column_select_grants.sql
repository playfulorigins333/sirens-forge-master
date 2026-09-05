begin;

-- Phase 7 added these non-credential lifecycle fields after LOCK-05B established
-- the authenticated profile column allowlist. Keep table SELECT revoked and add
-- only the two fields required by authenticated, own-profile application reads.
grant select (
  account_lifecycle_state,
  account_lifecycle_updated_at
) on public.profiles to authenticated;

do $profile_lifecycle_grants$
declare
  profiles_oid oid := to_regclass('public.profiles');
begin
  if profiles_oid is null
     or has_table_privilege('authenticated', profiles_oid, 'SELECT')
     or not has_column_privilege('authenticated', profiles_oid, 'account_lifecycle_state', 'SELECT')
     or not has_column_privilege('authenticated', profiles_oid, 'account_lifecycle_updated_at', 'SELECT')
     or has_column_privilege('authenticated', profiles_oid, 'password_hash', 'SELECT')
     or has_table_privilege('anon', profiles_oid, 'SELECT')
     or has_column_privilege('anon', profiles_oid, 'account_lifecycle_state', 'SELECT')
     or has_column_privilege('anon', profiles_oid, 'account_lifecycle_updated_at', 'SELECT')
     or has_column_privilege('anon', profiles_oid, 'password_hash', 'SELECT')
     or not has_table_privilege('service_role', profiles_oid, 'SELECT')
     or exists (
       select 1
       from (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as forbidden(privilege)
       where has_table_privilege('authenticated', profiles_oid, forbidden.privilege)
     )
     or not exists (
       select 1
       from pg_class
       where oid = profiles_oid and relrowsecurity and not relforcerowsecurity
     )
     or not exists (
       select 1
       from pg_policy
       where polrelid = profiles_oid
         and polname = 'profiles_authenticated_own_select'
         and polcmd = 'r'
         and polpermissive
         and polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
         and regexp_replace(lower(pg_get_expr(polqual, polrelid)), '[[:space:]()]', '', 'g') = 'user_id=auth.uid'
         and polwithcheck is null
     )
     or (select count(*) from pg_policy where polrelid = profiles_oid and polcmd = 'r') <> 1
  then
    raise exception 'PROFILE_LIFECYCLE_GRANTS_POSTCONDITION_FAILED: profile credential containment or own-profile RLS drifted';
  end if;
end $profile_lifecycle_grants$;

commit;
