begin;

drop policy if exists "Phase 7 active Twins only" on public.user_loras;
create policy "Phase 7 active Twins only"
on public.user_loras
as restrictive
for select
to authenticated
using (lifecycle_state='active');

commit;
