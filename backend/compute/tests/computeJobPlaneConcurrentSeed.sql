insert into auth.users values
 ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000003');
insert into public.user_loras(id,user_id,status) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','draft'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','draft');
insert into public.compute_spend_policies(version,effective_from,daily_limit_micros,monthly_limit_micros,video_job_limit_micros,enabled) values(1,now(),1000000,1000000,1000000,true);
insert into public.compute_scheduler_policies(workload,max_global_active,lease_seconds,stale_seconds,max_attempts,og_priority_seconds,spend_hold_seconds,enabled) values
 ('image',10,15,30,2,60,120,true),('trainer',10,15,30,2,60,120,true),('video',10,15,30,2,60,120,true),('stitch',10,15,30,2,0,120,true);

update public.compute_spend_policies set daily_limit_micros=1000,monthly_limit_micros=1000 where version=1;
select * from public.submit_compute_job('10000000-0000-4000-8000-000000000001','image','concurrent-spend-image',repeat('1',64),'{}','standard');
select * from public.submit_compute_job('10000000-0000-4000-8000-000000000002','trainer','concurrent-spend-trainer',repeat('2',64),'{}','standard');
select * from public.claim_compute_job('image','concurrent-spend-image-worker');
select * from public.claim_compute_job('trainer','concurrent-spend-trainer-worker');
