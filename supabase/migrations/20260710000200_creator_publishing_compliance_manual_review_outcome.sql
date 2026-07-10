-- Creator Publishing Queue compliance review outcome correction
-- Automated deterministic manual_review findings are not trusted human escalation approvals.
-- This migration adds an automated review outcome while preserving the invariant that
-- only outcome = 'escalate' with a nonblank escalated_approval_reason can authorize
-- the elevated package status.

alter table public.creator_publishing_compliance_reviews
  drop constraint if exists creator_publishing_compliance_reviews_outcome_check;

alter table public.creator_publishing_compliance_reviews
  add constraint creator_publishing_compliance_reviews_outcome_check
  check (outcome in ('pass','block','manual_review','escalate'));

alter table public.creator_publishing_compliance_reviews
  drop constraint if exists creator_publishing_review_escalate_requires_reason;

alter table public.creator_publishing_compliance_reviews
  add constraint creator_publishing_review_escalate_requires_reason
  check (outcome <> 'escalate' or length(btrim(coalesce(escalated_approval_reason, ''))) > 0);

create or replace function public.creator_publishing_escalated_approved_has_review()
returns trigger
language plpgsql
as $$
begin
  if new.compliance_status = 'escalated_approved' and not exists (
    select 1 from public.creator_publishing_compliance_reviews r
    where r.content_package_id = new.id
      and r.outcome = 'escalate'
      and length(btrim(coalesce(r.escalated_approval_reason, ''))) > 0
  ) then
    raise exception 'escalated_approved requires an escalate compliance review with a reason';
  end if;
  return new;
end;
$$;
