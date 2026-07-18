\set ON_ERROR_STOP on
\echo 'Task 19 Storage policy remediation assertions starting'

create or replace function public.task19_storage_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end
$$;

select public.task19_storage_assert(
  (
    select count(*) = 0
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = any (
        array[
          'authenticated users can upload lora datasets lk1r3q_0',
          'allow anon uploads to lora-datasets',
          'allow authenticated uploads to lora-datasets',
          'sf_lora_datasets_insert_public',
          'sf_lora_datasets_update_public'
        ]
      )
  ),
  'all five obsolete LoRA Storage write policies were removed'
);

select public.task19_storage_assert(
  (
    select count(*) = 4
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  ),
  'only the four unrelated Storage policies remain'
);

select public.task19_storage_assert(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'service role can read lora datasets'
      and permissive = 'PERMISSIVE'
      and roles = array['service_role']::name[]
      and cmd = 'SELECT'
      and qual =
        '((bucket_id = ''lora-datasets''::text) AND (name ~~ ''lora_datasets/%''::text))'
      and with_check is null
  ),
  'service-role LoRA read policy remains unchanged'
);

select public.task19_storage_assert(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'service role can upload lora datasets'
      and permissive = 'PERMISSIVE'
      and roles = array['service_role']::name[]
      and cmd = 'INSERT'
      and qual is null
      and with_check =
        '((bucket_id = ''lora-datasets''::text) AND (name ~~ ''lora_datasets/%''::text))'
  ),
  'service-role LoRA upload policy remains unchanged'
);

select public.task19_storage_assert(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'service role full access to jobs'
      and permissive = 'PERMISSIVE'
      and roles = array['service_role']::name[]
      and cmd = 'ALL'
      and qual = '(bucket_id = ''jobs''::text)'
      and with_check = '(bucket_id = ''jobs''::text)'
  ),
  'service-role jobs policy remains unchanged'
);

select public.task19_storage_assert(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'users can read own job outputs'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'SELECT'
      and qual =
        '((bucket_id = ''jobs''::text) AND (name ~~ (auth.uid() || ''/%''::text)))'
      and with_check is null
  ),
  'authenticated jobs read policy remains unchanged'
);

select public.task19_storage_assert(
  to_regclass('storage.objects') is not null,
  'storage.objects still exists'
);

select public.task19_storage_assert(
  to_regclass('storage.buckets') is not null,
  'storage.buckets still exists'
);

select public.task19_storage_assert(
  has_schema_privilege('anon', 'storage', 'USAGE'),
  'anonymous retains Storage schema usage'
);

select public.task19_storage_assert(
  has_table_privilege('anon', 'storage.objects', 'INSERT'),
  'migration does not alter anonymous table-level INSERT grant'
);

select public.task19_storage_assert(
  has_table_privilege('anon', 'storage.objects', 'UPDATE'),
  'migration does not alter anonymous table-level UPDATE grant'
);

select public.task19_storage_assert(
  has_schema_privilege('authenticated', 'storage', 'USAGE'),
  'authenticated retains Storage schema usage'
);

select public.task19_storage_assert(
  has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
  'migration does not alter authenticated table-level INSERT grant'
);

select public.task19_storage_assert(
  has_table_privilege('authenticated', 'storage.objects', 'UPDATE'),
  'migration does not alter authenticated table-level UPDATE grant'
);

select public.task19_storage_assert(
  (
    select c.relacl is not distinct from before_acl.relacl
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    cross join task19_objects_acl_before before_acl
    where n.nspname = 'storage'
      and c.relname = 'objects'
  ),
  'storage.objects table-level grants remain unchanged'
);

set local role authenticated;

select set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  v_error_message text;
begin
  begin
    insert into storage.objects(id, bucket_id, name, owner)
    values (
      '00000000-0000-4000-8000-000000000119',
      'lora-datasets',
      'lora_datasets/authenticated-insert-must-fail.jpg',
      '00000000-0000-4000-8000-000000000001'
    );

    raise exception
      'ASSERTION_FAILED: authenticated INSERT unexpectedly succeeded';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_error_message = message_text;

      if position('row-level security policy' in v_error_message) = 0 then
        raise exception
          'ASSERTION_FAILED: authenticated INSERT failed for an unexpected reason: %',
          v_error_message;
      end if;
  end;
end
$$;

reset role;

set local role anon;

select set_config(
  'request.jwt.claim.role',
  'anon',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '',
  true
);

do $$
declare
  v_error_message text;
begin
  begin
    insert into storage.objects(id, bucket_id, name, owner)
    values (
      '00000000-0000-4000-8000-000000000120',
      'lora-datasets',
      'lora_datasets/anonymous-insert-must-fail.jpg',
      null
    );

    raise exception
      'ASSERTION_FAILED: anonymous INSERT unexpectedly succeeded';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_error_message = message_text;

      if position('row-level security policy' in v_error_message) = 0 then
        raise exception
          'ASSERTION_FAILED: anonymous INSERT failed for an unexpected reason: %',
          v_error_message;
      end if;
  end;
end
$$;

do $$
declare
  v_updated_count integer;
begin
  update storage.objects
  set name = 'lora_datasets/owner-null-update-must-fail.jpg'
  where id = '00000000-0000-4000-8000-000000000019'::uuid;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 0 then
    raise exception
      'ASSERTION_FAILED: anonymous owner-null UPDATE unexpectedly succeeded';
  end if;
end
$$;

reset role;

select public.task19_storage_assert(
  not exists (
    (
      select *
      from storage.buckets
      except
      select *
      from task19_buckets_before
    )
    union all
    (
      select *
      from task19_buckets_before
      except
      select *
      from storage.buckets
    )
  ),
  'existing Storage bucket metadata remains unchanged'
);

select public.task19_storage_assert(
  not exists (
    (
      select *
      from storage.objects
      except
      select *
      from task19_objects_before
    )
    union all
    (
      select *
      from task19_objects_before
      except
      select *
      from storage.objects
    )
  ),
  'existing Storage object metadata remains unchanged'
);

select public.task19_storage_assert(
  exists (
    select 1
    from storage.objects
    where id = '00000000-0000-4000-8000-000000000019'::uuid
      and bucket_id = 'lora-datasets'
      and name = 'lora_datasets/legacy-owner-null.jpg'
      and owner is null
  ),
  'former PUBLIC owner-null UPDATE path is rejected by RLS'
);

drop function public.task19_storage_assert(boolean, text);

\echo 'TASK19_STORAGE_POLICY_REMEDIATION_POSTGRES_TESTS_PASSED'
