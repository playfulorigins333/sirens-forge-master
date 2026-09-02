-- Trusted transactional operations. Browser roles cannot execute these functions.
create or replace function public.ensure_creator_reply_workspace(p_user_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select workspace_id into v_id from sirens_mind_creator_reply_workspace_members where user_id=p_user_id order by created_at limit 1;
  if v_id is null then
    insert into sirens_mind_creator_reply_workspaces(created_by_user_id,display_name) values(p_user_id,'Creator Reply') returning id into v_id;
    insert into sirens_mind_creator_reply_workspace_members(workspace_id,user_id,role) values(v_id,p_user_id,'owner');
  end if;
  return v_id;
end $$;
create or replace function public.creator_reply_save_checkpoint(p_workspace_id uuid,p_subscriber_id uuid,p_conversation_id uuid,p_expected_revision bigint,p_ciphertext text,p_key_version integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz=now();v_count integer;
begin
 update sirens_mind_creator_reply_conversations set checkpoint_ciphertext=p_ciphertext,checkpoint_key_version=p_key_version,checkpoint_revision=checkpoint_revision+1,last_used_at=v_now,updated_at=v_now
 where workspace_id=p_workspace_id and subscriber_id=p_subscriber_id and id=p_conversation_id and checkpoint_revision=p_expected_revision;
 get diagnostics v_count=row_count;if v_count<>1 then return false;end if;
 update sirens_mind_creator_reply_subscribers set last_used_at=v_now,updated_at=v_now where workspace_id=p_workspace_id and id=p_subscriber_id;
 return true;
end $$;
revoke all on function public.ensure_creator_reply_workspace(uuid) from public,anon,authenticated;
revoke all on function public.creator_reply_save_checkpoint(uuid,uuid,uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.ensure_creator_reply_workspace(uuid) to service_role;
grant execute on function public.creator_reply_save_checkpoint(uuid,uuid,uuid,bigint,text,integer) to service_role;
