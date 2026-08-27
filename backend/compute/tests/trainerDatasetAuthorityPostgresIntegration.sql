set client_min_messages=warning;
do $$ begin
 assert not has_table_privilege('anon','public.dataset_doctor_jobs','select');
 assert not has_table_privilege('authenticated','public.dataset_doctor_jobs','insert');
 assert not has_table_privilege('authenticated','public.dataset_doctor_images','update');
 assert not has_table_privilege('authenticated','public.dataset_doctor_selections','delete');
 assert not has_table_privilege('authenticated','public.user_loras','insert');
 assert has_table_privilege('authenticated','public.user_loras','select');
 assert has_table_privilege('service_role','public.dataset_doctor_jobs','insert');
 assert not has_function_privilege('authenticated','public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text)','execute');
 assert has_function_privilege('service_role','public.submit_trainer_compute_job(uuid,uuid,text,text,jsonb,text,text,text)','execute');
 assert to_regprocedure('public.finalize_trainer_compute_job(uuid,uuid,uuid,text,text)') is not null;
 assert to_regclass('public.video_projects') is null; -- isolated fixture; source regression checks Pass 4C separately
end $$;
