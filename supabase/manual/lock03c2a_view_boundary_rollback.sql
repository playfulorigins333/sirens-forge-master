-- EMERGENCY MANUAL ROLLBACK ONLY.
-- This rollback reopens the browser-readable security exposure and requires explicit human approval.
-- Never run automatically. This is source-only preparation and does not itself authorize Production execution.

begin;

do $$
declare
  drifted boolean;
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
  ) into drifted;

  if drifted then
    raise exception using errcode = 'P0001', message = 'LOCK03C2A_ROLLBACK_DRIFT';
  end if;
end
$$;

grant select on public.lora_notification_payload to anon;
grant select on public.lora_notification_payload to authenticated;

alter view public.dataset_doctor_review_v reset (security_invoker);
grant select on public.dataset_doctor_review_v to anon;
grant select on public.dataset_doctor_review_v to authenticated;

do $$
declare
  failed boolean;
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
  ) into failed;

  if failed then
    raise exception using errcode = 'P0001', message = 'LOCK03C2A_ROLLBACK_POSTCONDITION_FAILED';
  end if;
end
$$;

commit;
