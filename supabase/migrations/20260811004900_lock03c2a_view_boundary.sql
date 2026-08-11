begin;

do $$
declare
  drifted boolean;
begin
  select exists (
    select 1
    from (values
      ('lora_notification_payload'),
      ('dataset_doctor_review_v')
    ) as target(name)
    left join pg_namespace n on n.nspname = 'public'
    left join pg_class c on c.relnamespace = n.oid and c.relname = target.name
    where c.oid is null
       or c.relkind <> 'v'
       or coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
       or not has_table_privilege('anon', c.oid, 'SELECT')
       or not has_table_privilege('authenticated', c.oid, 'SELECT')
       or not has_table_privilege('service_role', c.oid, 'SELECT')
  ) into drifted;

  if drifted then
    raise exception using errcode = 'P0001', message = 'LOCK03C2A_DRIFT';
  end if;
end
$$;

revoke select on public.lora_notification_payload from anon;
revoke select on public.lora_notification_payload from authenticated;

alter view public.dataset_doctor_review_v set (security_invoker = true);
revoke select on public.dataset_doctor_review_v from anon;
revoke select on public.dataset_doctor_review_v from authenticated;

do $$
declare
  failed boolean;
begin
  select exists (
    select 1
    from (values
      ('lora_notification_payload', false),
      ('dataset_doctor_review_v', true)
    ) as target(name, expected_invoker)
    left join pg_namespace n on n.nspname = 'public'
    left join pg_class c on c.relnamespace = n.oid and c.relname = target.name
    where c.oid is null
       or c.relkind <> 'v'
       or (coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']) <> target.expected_invoker
       or has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT')
       or not has_table_privilege('service_role', c.oid, 'SELECT')
  ) into failed;

  if failed then
    raise exception using errcode = 'P0001', message = 'LOCK03C2A_POSTCONDITION_FAILED';
  end if;
end
$$;

commit;
