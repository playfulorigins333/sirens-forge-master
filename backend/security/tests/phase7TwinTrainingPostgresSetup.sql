\set ON_ERROR_STOP on
create schema if not exists auth;
do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;end$$;
create table auth.users(id uuid primary key);
create type public.lora_status as enum ('idle','queued','training','completed','failed','draft');
create type public.compute_workload as enum ('trainer','image','video','stitch');
create type public.compute_job_state as enum ('queued','claimed','running','recovering','cancel_requested','succeeded','failed','cancelled');

create table public.user_loras(
 id uuid primary key,user_id uuid references auth.users(id),name text,lora_url text,preview_url text,status public.lora_status,image_count integer default 0,training_job_id text,progress integer,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,error_message text,
 artifact_r2_bucket text,artifact_r2_key text,dataset_r2_bucket text,dataset_r2_prefix text,trigger_token text,dataset_doctor_job_id uuid,
 source text,base_model text,prompt text,negative_prompt text,selection jsonb,is_identity_seed boolean default false
);
create table public.dataset_doctor_jobs(
 id uuid primary key,lora_id uuid not null references public.user_loras(id) on delete cascade,user_id uuid not null,status text not null default 'uploaded',
 raw_count integer not null default 0,accepted_count integer not null default 0,rejected_count integer not null default 0,review_count integer not null default 0,needs_more_images boolean not null default false,
 missing_coverage jsonb not null default '[]',summary jsonb not null default '{}',raw_r2_bucket text,raw_r2_prefix text,final_r2_bucket text,final_r2_prefix text,auto_approve boolean not null default false,
 approved_at timestamptz,exported_at timestamptz,error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.user_loras add constraint user_loras_dataset_doctor_job_id_fkey foreign key(dataset_doctor_job_id) references public.dataset_doctor_jobs(id) on delete set null;
create table public.dataset_doctor_images(
 id uuid primary key,job_id uuid not null references public.dataset_doctor_jobs(id) on delete cascade,lora_id uuid not null references public.user_loras(id) on delete cascade,user_id uuid not null,
 r2_bucket text not null,r2_key text not null,filename text not null,decision text not null default 'accept',analysis jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.dataset_doctor_selections(
 id uuid primary key,job_id uuid not null references public.dataset_doctor_jobs(id) on delete cascade,image_id uuid not null references public.dataset_doctor_images(id) on delete cascade,lora_id uuid not null references public.user_loras(id) on delete cascade,user_id uuid not null,selection_type text not null,created_at timestamptz not null default now()
);
create table public.compute_jobs(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,workload public.compute_workload not null,state public.compute_job_state not null default 'queued',idempotency_key text not null,request_fingerprint text not null,request_payload jsonb not null,priority_class text not null default 'standard',queued_at timestamptz not null default now(),available_at timestamptz not null default now(),attempt_count integer not null default 0,retry_count smallint not null default 0,max_attempts smallint not null default 3,lease_token uuid,lease_expires_at timestamptz,cancellation_requested_at timestamptz,internal_hold_code text,safe_error_code text,result_reference jsonb,started_at timestamptz,terminal_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.video_projects(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,identity_id uuid references public.user_loras(id) on delete restrict,source_generation_asset_id uuid,idempotency_key text not null,request_fingerprint text not null,request_payload jsonb not null,priority_class text not null,mode text not null,requested_duration_seconds integer not null,segment_count smallint not null,target_fps smallint not null default 30,target_min_short_edge integer not null default 1080,video_job_id uuid not null references public.compute_jobs(id),stitch_job_id uuid not null references public.compute_jobs(id),storage_bucket text,cancellation_requested_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

alter table public.user_loras enable row level security;
create policy "owner read" on public.user_loras for select to authenticated using (user_id=auth.uid());
grant select on public.user_loras to authenticated;
grant all on public.user_loras,public.dataset_doctor_jobs,public.dataset_doctor_images,public.dataset_doctor_selections,public.compute_jobs,public.video_projects to service_role;

insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.user_loras(id,user_id,name,status,image_count,artifact_r2_bucket,artifact_r2_key,dataset_r2_bucket,dataset_r2_prefix,trigger_token) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Twin One','completed',1,'identity-loras','loras/20000000-0000-4000-8000-000000000001/final.safetensors','identity-loras','attempts/20000000-0000-4000-8000-000000000001/job','twin_one'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Twin Two','completed',1,'identity-loras','loras/20000000-0000-4000-8000-000000000002/final.safetensors','identity-loras','attempts/20000000-0000-4000-8000-000000000002/job','twin_two'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Foreign Twin','completed',0,'identity-loras','loras/20000000-0000-4000-8000-000000000003/final.safetensors',null,null,'foreign');
insert into public.dataset_doctor_jobs(id,lora_id,user_id,status,raw_count,accepted_count,raw_r2_bucket,raw_r2_prefix,final_r2_bucket,final_r2_prefix,created_at,updated_at) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','exported',1,1,'identity-loras','dataset_doctor/20000000-0000-4000-8000-000000000001/raw','identity-loras','attempts/20000000-0000-4000-8000-000000000001/job',now()-interval '1 day',now()-interval '1 day');
update public.user_loras set dataset_doctor_job_id='30000000-0000-4000-8000-000000000001' where id='20000000-0000-4000-8000-000000000001';
insert into public.dataset_doctor_images(id,job_id,lora_id,user_id,r2_bucket,r2_key,filename) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','identity-loras','dataset_doctor/20000000-0000-4000-8000-000000000001/raw/a.png','a.png');
insert into public.dataset_doctor_selections(id,job_id,image_id,lora_id,user_id,selection_type) values('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','final');
