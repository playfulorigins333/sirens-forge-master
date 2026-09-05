insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
insert into public.account_deletion_protected_subjects(auth_user_id,reason)
values ('10000000-0000-4000-8000-000000000001','sole_production_admin_guard');

-- Unheld image compute payload is minimized on terminal transition.
insert into public.compute_jobs(id,owner_id,workload,state,request_payload) values (
 '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','image','running',
 '{"prompt":"private prompt","negative_prompt":"private negative","identity_id":"30000000-0000-4000-8000-000000000001","identity_reference":{"artifact":"secret"},"body_presentation":"body_feminine","width":1024,"height":1536,"steps":28,"cfg":7,"seed":42,"batch":1}'::jsonb
);
update public.compute_jobs set state='succeeded' where id='20000000-0000-4000-8000-000000000001';
do $$ declare p jsonb; begin
 select request_payload into p from public.compute_jobs where id='20000000-0000-4000-8000-000000000001';
 assert p->>'minimization_version'='1';
 assert not (p ? 'prompt');
 assert not (p ? 'negative_prompt');
 assert not (p ? 'identity_reference');
 assert p->>'identity_id'='30000000-0000-4000-8000-000000000001';
 assert p->>'width'='1024';
end $$;

-- Terminal payload cannot silently regain private content.
update public.compute_jobs
 set request_payload=request_payload || '{"prompt":"reintroduced","negative_prompt":"again"}'::jsonb
 where id='20000000-0000-4000-8000-000000000001';
do $$ declare p jsonb; begin
 select request_payload into p from public.compute_jobs where id='20000000-0000-4000-8000-000000000001';
 assert not (p ? 'prompt'); assert not (p ? 'negative_prompt');
end $$;

-- Generation canonical prompt survives while duplicate metadata is removed.
insert into public.generations(id,user_id,prompt,negative_prompt,metadata) values (
 '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
 'canonical creator prompt','canonical negative',
 '{"engine":"comfyui","prompt":"duplicate prompt","negative_prompt":"duplicate negative","request":{"seed":42},"identity_lora":"duplicate identity","output_url":"https://example.invalid/private","policy_version":1}'::jsonb
);
do $$ declare g public.generations; begin
 select * into g from public.generations where id='40000000-0000-4000-8000-000000000001';
 assert g.prompt='canonical creator prompt';
 assert g.negative_prompt='canonical negative';
 assert not (g.metadata ? 'prompt');
 assert not (g.metadata ? 'negative_prompt');
 assert not (g.metadata ? 'request');
 assert not (g.metadata ? 'identity_lora');
 assert g.metadata->>'engine'='comfyui';
 assert g.metadata->>'output_url'='https://example.invalid/private';
end $$;

-- Establish a finite active legal hold for the second creator.
select public.append_governance_audit_event(
 '10000000-0000-4000-8000-000000000001','founder_admin','legal_hold_opened','legal_hold',
 '50000000-0000-4000-8000-000000000001','legal','test hold','active','phase8b-test','legal-hold-open-v1',
 '60000000-0000-4000-8000-000000000001',null,'{}'::jsonb,'{}'::jsonb,null
) as audit_id \gset
insert into public.governance_legal_holds(
 id,actor_user_id,category,reason,status,opened_at,review_due_at,expires_at,fresh_auth_at,fresh_auth_method,
 policy_version,correlation_id,open_idempotency_key,open_request_fingerprint,opened_audit_event_id,created_at,updated_at
) values (
 '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','legal','test hold','active',
 clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',clock_timestamp(),'totp',
 'phase8b-test','60000000-0000-4000-8000-000000000001','phase8bhold01',repeat('a',64),:'audit_id',clock_timestamp(),clock_timestamp()
);

-- Held compute job preserves the original private request payload.
insert into public.compute_jobs(id,owner_id,workload,state,request_payload) values (
 '20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','image','running',
 '{"prompt":"held private prompt","negative_prompt":"held negative","width":512}'::jsonb
);
insert into public.governance_legal_hold_targets(hold_id,target_type,target_id,subject_user_id,preservation_scope)
values ('50000000-0000-4000-8000-000000000001','compute_job','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','full request evidence');
update public.compute_jobs set state='failed' where id='20000000-0000-4000-8000-000000000002';
do $$ declare p jsonb; begin
 select request_payload into p from public.compute_jobs where id='20000000-0000-4000-8000-000000000002';
 assert p->>'prompt'='held private prompt';
 assert p->>'negative_prompt'='held negative';
end $$;

-- Held generation metadata may be preserved on subsequent writes.
insert into public.generations(id,user_id,prompt,negative_prompt,metadata) values (
 '40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','held canonical',null,'{}'::jsonb
);
insert into public.governance_legal_hold_targets(hold_id,target_type,target_id,subject_user_id,preservation_scope)
values ('50000000-0000-4000-8000-000000000001','generation','40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','generation metadata evidence');
update public.generations set metadata='{"prompt":"held metadata copy","request":{"seed":9}}'::jsonb
where id='40000000-0000-4000-8000-000000000002';
do $$ declare m jsonb; begin
 select metadata into m from public.generations where id='40000000-0000-4000-8000-000000000002';
 assert m->>'prompt'='held metadata copy'; assert m ? 'request';
end $$;
