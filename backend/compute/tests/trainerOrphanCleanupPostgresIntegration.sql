insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002');

insert into public.user_loras(id,user_id,status,training_job_id,error_message,artifact_r2_bucket,artifact_r2_key,dataset_r2_bucket,dataset_r2_prefix) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','queued',null,null,null,null,'datasets','orphan-queued'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','training','40000000-0000-4000-8000-000000000002',null,null,null,'datasets','wrong-owner'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','queued','40000000-0000-4000-8000-000000000003',null,null,null,'datasets','valid'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','training',null,null,'models','loras/legacy/final.safetensors','datasets','artifact-backed'),
 ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','completed',null,null,'models','loras/historical/final.safetensors','datasets','historical'),
 ('30000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','completed',null,null,null,null,'datasets','artifactless'),
 ('30000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','draft',null,null,null,null,'datasets','draft'),
 ('30000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','failed',null,'OLD_FAILURE',null,null,'datasets','failed');

insert into public.compute_jobs(id,owner_id,workload,idempotency_key,request_fingerprint,request_payload,priority_class,max_attempts) values
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','trainer','wrong-owner',repeat('a',64),'{"identity_id":"30000000-0000-4000-8000-000000000002"}','standard',3),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','trainer','valid',repeat('b',64),'{"identity_id":"30000000-0000-4000-8000-000000000003"}','standard',3);

\ir ../../../supabase/migrations/20260828085501_repair_orphaned_trainer_states.sql

do $$ begin
 assert (select status='failed' and error_message='TRAINER_STATE_ORPHANED' and dataset_r2_prefix='orphan-queued' from public.user_loras where id='30000000-0000-4000-8000-000000000001');
 assert (select status='failed' and error_message='TRAINER_STATE_ORPHANED' and dataset_r2_prefix='wrong-owner' from public.user_loras where id='30000000-0000-4000-8000-000000000002');
 assert (select status='queued' and error_message is null from public.user_loras where id='30000000-0000-4000-8000-000000000003');
 assert (select status='training' and artifact_r2_key='loras/legacy/final.safetensors' from public.user_loras where id='30000000-0000-4000-8000-000000000004');
 assert (select status='completed' and artifact_r2_key='loras/historical/final.safetensors' from public.user_loras where id='30000000-0000-4000-8000-000000000005');
 assert (select status='completed' from public.user_loras where id='30000000-0000-4000-8000-000000000006');
 assert (select status='draft' from public.user_loras where id='30000000-0000-4000-8000-000000000007');
 assert (select status='failed' and error_message='OLD_FAILURE' from public.user_loras where id='30000000-0000-4000-8000-000000000008');
end $$;

create temporary table repaired_snapshot as select id,status,error_message,updated_at,dataset_r2_bucket,dataset_r2_prefix from public.user_loras;
\ir ../../../supabase/migrations/20260828085501_repair_orphaned_trainer_states.sql

do $$ begin
 assert not exists (
   (select id,status,error_message,updated_at,dataset_r2_bucket,dataset_r2_prefix from public.user_loras
    except select * from repaired_snapshot)
   union all
   (select * from repaired_snapshot
    except select id,status,error_message,updated_at,dataset_r2_bucket,dataset_r2_prefix from public.user_loras)
 );
end $$;
