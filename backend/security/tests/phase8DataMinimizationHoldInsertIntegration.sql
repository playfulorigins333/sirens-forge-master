-- A legal hold may target a known generation ID before the row is written.
insert into public.governance_legal_hold_targets(hold_id,target_type,target_id,subject_user_id,preservation_scope)
values ('50000000-0000-4000-8000-000000000001','generation','40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','pre-write generation evidence');

insert into public.generations(id,user_id,prompt,negative_prompt,metadata) values (
 '40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','held insert canonical',null,
 '{"prompt":"held insert metadata copy","request":{"seed":17}}'::jsonb
);

do $$ declare m jsonb; begin
 select metadata into m from public.generations where id='40000000-0000-4000-8000-000000000003';
 assert m->>'prompt'='held insert metadata copy';
 assert m ? 'request';
end $$;
