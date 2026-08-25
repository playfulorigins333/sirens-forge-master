insert into auth.users values
 ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000003');
insert into public.compute_scheduler_policies(workload,max_global_active,lease_seconds,stale_seconds,max_attempts,og_priority_seconds,spend_hold_seconds,enabled) values
 ('image',10,15,30,2,60,120,true),('trainer',10,15,30,2,60,120,true),('video',10,15,30,2,60,120,true),('stitch',10,15,30,2,60,120,true);
