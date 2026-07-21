-- Sanitized Gate 21C-1 integration assertions. Fixture IDs and rows are intentionally not printed.
do $$ begin
  if not exists (select 1 from pg_proc where proname='creator_publishing_save_content_package') then raise exception 'package rpc missing'; end if;
  if not exists (select 1 from pg_proc where proname='creator_publishing_create_autopost_plan') then raise exception 'plan rpc missing'; end if;
  if has_function_privilege('public', 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)', 'execute') then raise exception 'public package execute'; end if;
  if not has_function_privilege('service_role', 'public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)', 'execute') then raise exception 'service package execute missing'; end if;
  if position('DESTINATION_ACCOUNT_NOT_VERIFIED' in pg_get_functiondef('public.creator_publishing_save_content_package(uuid,text,uuid,uuid,text,text,boolean,text,text,timestamptz,text)'::regprocedure))=0 then raise exception 'package verification guard missing'; end if;
  if position('autopost_locked_destination_accounts' in pg_get_functiondef('public.creator_publishing_create_autopost_plan(uuid,uuid[],text)'::regprocedure))=0 then raise exception 'plan account locking missing'; end if;
end $$;
