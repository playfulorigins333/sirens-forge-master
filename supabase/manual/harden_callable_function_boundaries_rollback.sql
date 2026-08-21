-- EMERGENCY MANUAL ROLLBACK ONLY.
-- Requires explicit human approval. Never run automatically.
-- Restores the audited browser-executable pre-state; does not touch migration history.
begin;

do $rollback_pre$
declare v_bad boolean;
begin
  select count(*) <> 21 or bool_or(owner_role.rolname <> 'postgres' or p.prosecdef
    or p.proconfig <> array['search_path='||target.wanted_path]::text[]
    or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
    or has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE') or not has_function_privilege('postgres',p.oid,'EXECUTE'))
  into v_bad from (values
      ('auto_approve_caption_templates','','pg_catalog, public, pg_temp'),
      ('auto_approve_cta_variants','','pg_catalog, public, pg_temp'),
      ('auto_approve_hashtag_sets','','pg_catalog, public, pg_temp'),
      ('claim_next_lora_job','','pg_catalog, pg_temp'),
      ('creator_publishing_audit_events_prevent_mutation','','pg_catalog, pg_temp'),
      ('creator_publishing_escalated_approved_has_review','','pg_catalog, pg_temp'),
      ('creator_publishing_prevent_creator_controlled_field_update','','pg_catalog, pg_temp'),
      ('creator_publishing_queue_jsonb_has_forbidden_credential_key','jsonb','pg_catalog, pg_temp'),
      ('dataset_doctor_images_enforce_parent_match','','pg_catalog, pg_temp'),
      ('dataset_doctor_images_refresh_counts','','pg_catalog, pg_temp'),
      ('dataset_doctor_mark_approved','uuid, text, text','pg_catalog, pg_temp'),
      ('dataset_doctor_mark_exported','uuid','pg_catalog, pg_temp'),
      ('dataset_doctor_queue_lora_training','uuid, text, text, integer','pg_catalog, pg_temp'),
      ('dataset_doctor_selections_enforce_parent_match','','pg_catalog, pg_temp'),
      ('dataset_doctor_set_active_job','uuid, uuid','pg_catalog, pg_temp'),
      ('increment_generation_count','','pg_catalog, public, pg_temp'),
      ('refresh_dataset_doctor_job_counts','uuid','pg_catalog, pg_temp'),
      ('set_updated_at','','pg_catalog, pg_temp'),
      ('update_collection_item_count','','pg_catalog, public, pg_temp'),
      ('update_collections_updated_at','','pg_catalog, pg_temp'),
      ('update_updated_at_column','','pg_catalog, pg_temp')
    ) target(name,args,wanted_path)
    left join pg_catalog.pg_namespace n on n.nspname='public'
    left join pg_catalog.pg_proc p on p.pronamespace=n.oid and p.proname=target.name and pg_catalog.oidvectortypes(p.proargtypes)=target.args
    left join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner;
  if coalesce(v_bad,true) then raise exception using errcode='P0001',message='CALLABLE_FUNCTION_ROLLBACK_DRIFT'; end if;
  if exists(select 1 from (values ('caption_templates','trg_auto_approve_caption_templates','auto_approve_caption_templates'),
      ('cta_variants','trg_auto_approve_cta_variants','auto_approve_cta_variants'),
      ('hashtag_sets','trg_auto_approve_hashtag_sets','auto_approve_hashtag_sets'),
      ('creator_publishing_audit_events','trg_creator_publishing_audit_events_no_delete','creator_publishing_audit_events_prevent_mutation'),
      ('creator_publishing_audit_events','trg_creator_publishing_audit_events_no_update','creator_publishing_audit_events_prevent_mutation'),
      ('creator_publishing_content_packages','trg_creator_publishing_escalated_approved_has_review','creator_publishing_escalated_approved_has_review'),
      ('creator_publishing_content_packages','trg_creator_publishing_prevent_creator_controlled_field_update','creator_publishing_prevent_creator_controlled_field_update'),
      ('dataset_doctor_images','trg_dataset_doctor_images_parent_match','dataset_doctor_images_enforce_parent_match'),
      ('dataset_doctor_images','trg_dataset_doctor_images_refresh_counts','dataset_doctor_images_refresh_counts'),
      ('dataset_doctor_selections','trg_dataset_doctor_selections_parent_match','dataset_doctor_selections_enforce_parent_match'),
      ('generations','increment_user_generations','increment_generation_count'),
      ('collection_items','update_collection_items_count','update_collection_item_count'),
      ('collections','trigger_update_collections_timestamp','update_collections_updated_at'),
      ('affiliate_ledger','*','set_updated_at'),
      ('autopost_accounts','*','set_updated_at'),
      ('autopost_jobs','*','set_updated_at'),
      ('autopost_rules','*','set_updated_at'),
      ('content_post_media','*','set_updated_at'),
      ('content_post_targets','*','set_updated_at'),
      ('content_posts','*','set_updated_at'),
      ('creator_platform_accounts','*','set_updated_at'),
      ('creator_publishing_ai_twin_consents','*','set_updated_at'),
      ('creator_publishing_content_packages','*','set_updated_at'),
      ('creator_publishing_creator_verifications','*','set_updated_at'),
      ('creator_publishing_operator_authorizations','*','set_updated_at'),
      ('creator_publishing_plans','*','set_updated_at'),
      ('creator_publishing_platform_capabilities','*','set_updated_at'),
      ('creator_publishing_platform_jobs','*','set_updated_at'),
      ('creator_publishing_queue_tasks','*','set_updated_at'),
      ('creator_publishing_scheduler_events','*','set_updated_at'),
      ('dataset_doctor_images','*','set_updated_at'),
      ('dataset_doctor_jobs','*','set_updated_at'),
      ('ai_influencers','*','update_updated_at_column'),
      ('collections','*','update_updated_at_column'),
      ('commissions','*','update_updated_at_column'),
      ('content_posts_legacy_ai_influencer','*','update_updated_at_column'),
      ('crypto_payments','*','update_updated_at_column'),
      ('crypto_wallet_addresses','*','update_updated_at_column'),
      ('generations','*','update_updated_at_column'),
      ('payouts','*','update_updated_at_column'),
      ('profiles','*','update_updated_at_column'),
      ('subscription_tiers','*','update_updated_at_column'),
      ('system_stats','*','update_updated_at_column'),
      ('user_subscriptions','*','update_updated_at_column')) expected(rel,trg,fn) where not exists(select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid where n.nspname='public' and c.relname=expected.rel and (expected.trg='*' or t.tgname=expected.trg) and p.proname=expected.fn and not t.tgisinternal and t.tgenabled<>'D')) then raise exception using errcode='P0001',message='CALLABLE_FUNCTION_TRIGGER_POSTCONDITION_FAILED'; end if;
end $rollback_pre$;

alter function public.auto_approve_caption_templates() reset search_path;
grant execute on function public.auto_approve_caption_templates() to public, anon, authenticated;
alter function public.auto_approve_cta_variants() reset search_path;
grant execute on function public.auto_approve_cta_variants() to public, anon, authenticated;
alter function public.auto_approve_hashtag_sets() reset search_path;
grant execute on function public.auto_approve_hashtag_sets() to public, anon, authenticated;
alter function public.claim_next_lora_job() reset search_path;
grant execute on function public.claim_next_lora_job() to public, anon, authenticated;
alter function public.creator_publishing_audit_events_prevent_mutation() reset search_path;
grant execute on function public.creator_publishing_audit_events_prevent_mutation() to public, anon, authenticated;
alter function public.creator_publishing_escalated_approved_has_review() reset search_path;
grant execute on function public.creator_publishing_escalated_approved_has_review() to public, anon, authenticated;
alter function public.creator_publishing_prevent_creator_controlled_field_update() reset search_path;
grant execute on function public.creator_publishing_prevent_creator_controlled_field_update() to public, anon, authenticated;
alter function public.creator_publishing_queue_jsonb_has_forbidden_credential_key(jsonb) reset search_path;
grant execute on function public.creator_publishing_queue_jsonb_has_forbidden_credential_key(jsonb) to public, anon, authenticated;
alter function public.dataset_doctor_images_enforce_parent_match() reset search_path;
grant execute on function public.dataset_doctor_images_enforce_parent_match() to public, anon, authenticated;
alter function public.dataset_doctor_images_refresh_counts() reset search_path;
grant execute on function public.dataset_doctor_images_refresh_counts() to public, anon, authenticated;
alter function public.dataset_doctor_mark_approved(uuid, text, text) reset search_path;
grant execute on function public.dataset_doctor_mark_approved(uuid, text, text) to public, anon, authenticated;
alter function public.dataset_doctor_mark_exported(uuid) reset search_path;
grant execute on function public.dataset_doctor_mark_exported(uuid) to public, anon, authenticated;
alter function public.dataset_doctor_queue_lora_training(uuid, text, text, integer) reset search_path;
grant execute on function public.dataset_doctor_queue_lora_training(uuid, text, text, integer) to public, anon, authenticated;
alter function public.dataset_doctor_selections_enforce_parent_match() reset search_path;
grant execute on function public.dataset_doctor_selections_enforce_parent_match() to public, anon, authenticated;
alter function public.dataset_doctor_set_active_job(uuid, uuid) reset search_path;
grant execute on function public.dataset_doctor_set_active_job(uuid, uuid) to public, anon, authenticated;
alter function public.increment_generation_count() reset search_path;
grant execute on function public.increment_generation_count() to public, anon, authenticated;
alter function public.refresh_dataset_doctor_job_counts(uuid) reset search_path;
grant execute on function public.refresh_dataset_doctor_job_counts(uuid) to public, anon, authenticated;
alter function public.set_updated_at() reset search_path;
grant execute on function public.set_updated_at() to public, anon, authenticated;
alter function public.update_collection_item_count() reset search_path;
grant execute on function public.update_collection_item_count() to public, anon, authenticated;
alter function public.update_collections_updated_at() reset search_path;
grant execute on function public.update_collections_updated_at() to public, anon, authenticated;
alter function public.update_updated_at_column() reset search_path;
grant execute on function public.update_updated_at_column() to public, anon, authenticated;

do $rollback_post$
declare v_bad boolean;
begin
  select count(*) <> 21 or bool_or(owner_role.rolname <> 'postgres' or p.prosecdef or p.proconfig is not null
    or not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') or not has_function_privilege('anon',p.oid,'EXECUTE')
    or not has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE')
    or not has_function_privilege('postgres',p.oid,'EXECUTE')
    or (select count(*) from pg_catalog.aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and not a.is_grantable) <> 5
    or exists(select 1 from pg_catalog.aclexplode(p.proacl) a left join pg_catalog.pg_roles r on r.oid=a.grantee where a.privilege_type<>'EXECUTE' or a.is_grantable or coalesce(r.rolname,'PUBLIC') not in ('PUBLIC','postgres','anon','authenticated','service_role')))
  into v_bad from (values
      ('auto_approve_caption_templates','','pg_catalog, public, pg_temp'),
      ('auto_approve_cta_variants','','pg_catalog, public, pg_temp'),
      ('auto_approve_hashtag_sets','','pg_catalog, public, pg_temp'),
      ('claim_next_lora_job','','pg_catalog, pg_temp'),
      ('creator_publishing_audit_events_prevent_mutation','','pg_catalog, pg_temp'),
      ('creator_publishing_escalated_approved_has_review','','pg_catalog, pg_temp'),
      ('creator_publishing_prevent_creator_controlled_field_update','','pg_catalog, pg_temp'),
      ('creator_publishing_queue_jsonb_has_forbidden_credential_key','jsonb','pg_catalog, pg_temp'),
      ('dataset_doctor_images_enforce_parent_match','','pg_catalog, pg_temp'),
      ('dataset_doctor_images_refresh_counts','','pg_catalog, pg_temp'),
      ('dataset_doctor_mark_approved','uuid, text, text','pg_catalog, pg_temp'),
      ('dataset_doctor_mark_exported','uuid','pg_catalog, pg_temp'),
      ('dataset_doctor_queue_lora_training','uuid, text, text, integer','pg_catalog, pg_temp'),
      ('dataset_doctor_selections_enforce_parent_match','','pg_catalog, pg_temp'),
      ('dataset_doctor_set_active_job','uuid, uuid','pg_catalog, pg_temp'),
      ('increment_generation_count','','pg_catalog, public, pg_temp'),
      ('refresh_dataset_doctor_job_counts','uuid','pg_catalog, pg_temp'),
      ('set_updated_at','','pg_catalog, pg_temp'),
      ('update_collection_item_count','','pg_catalog, public, pg_temp'),
      ('update_collections_updated_at','','pg_catalog, pg_temp'),
      ('update_updated_at_column','','pg_catalog, pg_temp')
    ) target(name,args,wanted_path)
    left join pg_catalog.pg_namespace n on n.nspname='public'
    left join pg_catalog.pg_proc p on p.pronamespace=n.oid and p.proname=target.name and pg_catalog.oidvectortypes(p.proargtypes)=target.args
    left join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner;
  if coalesce(v_bad,true) then raise exception using errcode='P0001',message='CALLABLE_FUNCTION_ROLLBACK_POSTCONDITION_FAILED'; end if;
  if exists(select 1 from (values
      ('caption_templates','trg_auto_approve_caption_templates','auto_approve_caption_templates'),
      ('cta_variants','trg_auto_approve_cta_variants','auto_approve_cta_variants'),
      ('hashtag_sets','trg_auto_approve_hashtag_sets','auto_approve_hashtag_sets'),
      ('creator_publishing_audit_events','trg_creator_publishing_audit_events_no_delete','creator_publishing_audit_events_prevent_mutation'),
      ('creator_publishing_audit_events','trg_creator_publishing_audit_events_no_update','creator_publishing_audit_events_prevent_mutation'),
      ('creator_publishing_content_packages','trg_creator_publishing_escalated_approved_has_review','creator_publishing_escalated_approved_has_review'),
      ('creator_publishing_content_packages','trg_creator_publishing_prevent_creator_controlled_field_update','creator_publishing_prevent_creator_controlled_field_update'),
      ('dataset_doctor_images','trg_dataset_doctor_images_parent_match','dataset_doctor_images_enforce_parent_match'),
      ('dataset_doctor_images','trg_dataset_doctor_images_refresh_counts','dataset_doctor_images_refresh_counts'),
      ('dataset_doctor_selections','trg_dataset_doctor_selections_parent_match','dataset_doctor_selections_enforce_parent_match'),
      ('generations','increment_user_generations','increment_generation_count'),
      ('collection_items','update_collection_items_count','update_collection_item_count'),
      ('collections','trigger_update_collections_timestamp','update_collections_updated_at'),
      ('affiliate_ledger','*','set_updated_at'),
      ('autopost_accounts','*','set_updated_at'),
      ('autopost_jobs','*','set_updated_at'),
      ('autopost_rules','*','set_updated_at'),
      ('content_post_media','*','set_updated_at'),
      ('content_post_targets','*','set_updated_at'),
      ('content_posts','*','set_updated_at'),
      ('creator_platform_accounts','*','set_updated_at'),
      ('creator_publishing_ai_twin_consents','*','set_updated_at'),
      ('creator_publishing_content_packages','*','set_updated_at'),
      ('creator_publishing_creator_verifications','*','set_updated_at'),
      ('creator_publishing_operator_authorizations','*','set_updated_at'),
      ('creator_publishing_plans','*','set_updated_at'),
      ('creator_publishing_platform_capabilities','*','set_updated_at'),
      ('creator_publishing_platform_jobs','*','set_updated_at'),
      ('creator_publishing_queue_tasks','*','set_updated_at'),
      ('creator_publishing_scheduler_events','*','set_updated_at'),
      ('dataset_doctor_images','*','set_updated_at'),
      ('dataset_doctor_jobs','*','set_updated_at'),
      ('ai_influencers','*','update_updated_at_column'),
      ('collections','*','update_updated_at_column'),
      ('commissions','*','update_updated_at_column'),
      ('content_posts_legacy_ai_influencer','*','update_updated_at_column'),
      ('crypto_payments','*','update_updated_at_column'),
      ('crypto_wallet_addresses','*','update_updated_at_column'),
      ('generations','*','update_updated_at_column'),
      ('payouts','*','update_updated_at_column'),
      ('profiles','*','update_updated_at_column'),
      ('subscription_tiers','*','update_updated_at_column'),
      ('system_stats','*','update_updated_at_column'),
      ('user_subscriptions','*','update_updated_at_column')
    ) expected(rel,trg,fn) where not exists(select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid where n.nspname='public' and c.relname=expected.rel and (expected.trg='*' or t.tgname=expected.trg) and p.proname=expected.fn and not t.tgisinternal and t.tgenabled<>'D')) then raise exception using errcode='P0001',message='CALLABLE_FUNCTION_TRIGGER_DRIFT'; end if;
end $rollback_post$;

commit;
