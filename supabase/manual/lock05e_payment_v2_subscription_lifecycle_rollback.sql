-- REPOSITORY ARTIFACT ONLY. Removes LOCK-05E additions without restoring data.
begin;
do $$declare v_oid oid;v_preexisting boolean;v_rows bigint;v_depend bigint;
begin
 if current_user<>'postgres' then raise exception 'lock05e_rollback_requires_postgres';end if;
 if to_regclass('lock05e_backup_20260811_pre_apply.manifest') is null then raise exception 'lock05e_backup_manifest_missing';end if;
 select a1_inbox_preexisting into strict v_preexisting from lock05e_backup_20260811_pre_apply.manifest;
 v_oid:=to_regprocedure('public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz)');
 if v_oid is null then raise exception 'lock05e_function_missing';end if;
 if exists(select 1 from pg_depend where refobjid=v_oid)then raise exception 'lock05e_unexpected_function_dependency';end if;
 execute 'drop function public.payment_v2_apply_early_bird_subscription_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz) restrict';
 if not v_preexisting then
  if to_regclass('public.payment_v2_provider_event_inbox') is null or to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)') is null or to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)') is null then raise exception 'lock05e_bridge_catalog_drift';end if;
  execute 'select count(*) from public.payment_v2_provider_event_inbox' into v_rows;if v_rows<>0 then raise exception 'lock05e_inbox_not_empty';end if;
  select count(*) into v_depend from pg_depend where refobjid in(to_regprocedure('public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer)'),to_regprocedure('public.payment_v2_inbox_transition_status(text,text,text,text,boolean)'));
  if v_depend<>0 then raise exception 'lock05e_bridge_unexpected_dependency';end if;
  execute 'drop function public.payment_v2_inbox_receive_event(text,text,text,text,timestamptz,text,text,integer) restrict';execute 'drop function public.payment_v2_inbox_transition_status(text,text,text,text,boolean) restrict';execute 'drop table public.payment_v2_provider_event_inbox restrict';
 end if;
end$$;
commit;
