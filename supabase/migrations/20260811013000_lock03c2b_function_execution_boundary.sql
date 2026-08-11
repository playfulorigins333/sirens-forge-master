begin;

do $$
declare
  drifted boolean;
begin
  select exists (
    select 1
    from (values
      ('add_tokens', 'uuid, integer, text'),
      ('deduct_tokens', 'uuid, integer'),
      ('deduct_tokens', 'uuid, integer, text'),
      ('record_lora_terminal_status', ''),
      ('creator_publishing_platform_account_clear_trusted_metadata', '')
    ) target(name, arguments)
    left join pg_namespace n on n.nspname = 'public'
    left join pg_proc p on p.pronamespace = n.oid
      and p.proname = target.name
      and pg_get_function_identity_arguments(p.oid) = target.arguments
    left join pg_roles owner_role on owner_role.oid = p.proowner
    where p.oid is null
       or owner_role.rolname <> 'postgres'
       or not p.prosecdef
       or not has_function_privilege('anon', p.oid, 'EXECUTE')
       or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or not has_function_privilege('service_role', p.oid, 'EXECUTE')
       or not exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) service_acl
         join pg_roles service_grantee on service_grantee.oid = service_acl.grantee
         where service_grantee.rolname = 'service_role' and service_acl.privilege_type = 'EXECUTE'
       )
       or not exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       )
  ) into drifted;

  drifted := drifted or not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'user_loras'
      and t.tgname = 'lora_terminal_status_trigger' and not t.tgisinternal
      and t.tgenabled <> 'D' and p.pronamespace = n.oid
      and p.proname = 'record_lora_terminal_status'
      and pg_get_function_identity_arguments(p.oid) = ''
      and p.prorettype = 'trigger'::regtype
      and pg_get_triggerdef(t.oid) ~* 'AFTER UPDATE OF status ON public\.user_loras'
  );
  drifted := drifted or not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'creator_platform_accounts'
      and t.tgname = 'trg_creator_platform_accounts_clear_trusted_metadata' and not t.tgisinternal
      and t.tgenabled <> 'D' and p.pronamespace = n.oid
      and p.proname = 'creator_publishing_platform_account_clear_trusted_metadata'
      and pg_get_function_identity_arguments(p.oid) = ''
      and p.prorettype = 'trigger'::regtype
      and pg_get_triggerdef(t.oid) ~* 'BEFORE UPDATE ON public\.creator_platform_accounts'
  );

  if drifted then
    raise exception using errcode = 'P0001', message = 'LOCK03C2B_DRIFT';
  end if;
end
$$;

revoke execute on function public.add_tokens(uuid, integer, text) from public;
revoke execute on function public.add_tokens(uuid, integer, text) from anon;
revoke execute on function public.add_tokens(uuid, integer, text) from authenticated;
revoke execute on function public.deduct_tokens(uuid, integer) from public;
revoke execute on function public.deduct_tokens(uuid, integer) from anon;
revoke execute on function public.deduct_tokens(uuid, integer) from authenticated;
revoke execute on function public.deduct_tokens(uuid, integer, text) from public;
revoke execute on function public.deduct_tokens(uuid, integer, text) from anon;
revoke execute on function public.deduct_tokens(uuid, integer, text) from authenticated;
revoke execute on function public.record_lora_terminal_status() from public;
revoke execute on function public.record_lora_terminal_status() from anon;
revoke execute on function public.record_lora_terminal_status() from authenticated;
revoke execute on function public.creator_publishing_platform_account_clear_trusted_metadata() from public;
revoke execute on function public.creator_publishing_platform_account_clear_trusted_metadata() from anon;
revoke execute on function public.creator_publishing_platform_account_clear_trusted_metadata() from authenticated;

do $$
declare
  failed boolean;
begin
  select exists (
    select 1
    from (values
      ('add_tokens', 'uuid, integer, text'),
      ('deduct_tokens', 'uuid, integer'),
      ('deduct_tokens', 'uuid, integer, text'),
      ('record_lora_terminal_status', ''),
      ('creator_publishing_platform_account_clear_trusted_metadata', '')
    ) target(name, arguments)
    left join pg_namespace n on n.nspname = 'public'
    left join pg_proc p on p.pronamespace = n.oid and p.proname = target.name
      and pg_get_function_identity_arguments(p.oid) = target.arguments
    left join pg_roles owner_role on owner_role.oid = p.proowner
    where p.oid is null or owner_role.rolname <> 'postgres' or not p.prosecdef
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or not has_function_privilege('service_role', p.oid, 'EXECUTE')
       or not exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) service_acl
         join pg_roles service_grantee on service_grantee.oid = service_acl.grantee
         where service_grantee.rolname = 'service_role' and service_acl.privilege_type = 'EXECUTE'
       )
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
  ) into failed;

  failed := failed or (select count(*) <> 2 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    where n.nspname='public' and t.tgenabled <> 'D' and not t.tgisinternal and
      ((c.relname='user_loras' and t.tgname='lora_terminal_status_trigger' and p.proname='record_lora_terminal_status') or
       (c.relname='creator_platform_accounts' and t.tgname='trg_creator_platform_accounts_clear_trusted_metadata' and p.proname='creator_publishing_platform_account_clear_trusted_metadata'))
      and pg_get_function_identity_arguments(p.oid)='');
  if failed then
    raise exception using errcode = 'P0001', message = 'LOCK03C2B_POSTCONDITION_FAILED';
  end if;
end
$$;

commit;
