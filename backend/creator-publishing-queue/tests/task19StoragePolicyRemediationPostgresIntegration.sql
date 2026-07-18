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
      and policyname =
        'authenticated users can upload lora datasets lk1r3q_0'
  ),
  'the exact obsolete authenticated LoRA upload policy was removed'
);

select public.task19_storage_assert(
  (
    select count(*) = 0
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'INSERT'
  ),
  'no INSERT policy remains on storage.objects'
);

select public.task19_storage_assert(
  (
    select count(*) = 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'task19 unrelated storage select policy'
  ),
  'an unrelated Storage policy remains unchanged'
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
  (
    select count(*) = 1
    from storage.objects
    where id = '00000000-0000-4000-8000-000000000019'::uuid
      and bucket_id = 'task19-sentinel-bucket'
      and name = 'task19/sentinel.jpg'
  ),
  'existing Storage object metadata remains untouched'
);

select public.task19_storage_assert(
  (
    select count(*) = 1
    from storage.buckets
    where id = 'task19-sentinel-bucket'
      and name = 'task19-sentinel-bucket'
  ),
  'existing Storage bucket metadata remains untouched'
);

select public.task19_storage_assert(
  has_schema_privilege('authenticated', 'storage', 'USAGE'),
  'authenticated retains Storage schema usage'
);

select public.task19_storage_assert(
  has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
  'the migration does not alter the authenticated table-level INSERT grant'
);

select public.task19_storage_assert(
  not has_table_privilege('anon', 'storage.objects', 'INSERT'),
  'the isolated fixture did not introduce anonymous INSERT access'
);

set local role authenticated;

select set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);

do $$
declare
  v_error_message text;
begin
  begin
    insert into storage.objects(id, bucket_id, name)
    values (
      '00000000-0000-4000-8000-000000000119',
      'task19-sentinel-bucket',
      'task19/authenticated-insert-must-fail.jpg'
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

drop function public.task19_storage_assert(boolean, text);

\echo 'TASK19_STORAGE_POLICY_REMEDIATION_POSTGRES_TESTS_PASSED'
