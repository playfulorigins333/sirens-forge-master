create or replace function public.creator_reply_save_checkpoint(p_workspace_id uuid,p_subscriber_id uuid,p_conversation_id uuid,p_expected_revision bigint,p_ciphertext text,p_key_version integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz=now();v_count integer;
begin
 update sirens_mind_creator_reply_conversations set checkpoint_ciphertext=p_ciphertext,checkpoint_key_version=p_key_version,checkpoint_revision=checkpoint_revision+1,last_used_at=v_now,updated_at=v_now
 where workspace_id=p_workspace_id and subscriber_id=p_subscriber_id and id=p_conversation_id and status='active' and checkpoint_revision=p_expected_revision;
 get diagnostics v_count=row_count;if v_count<>1 then return false;end if;
 update sirens_mind_creator_reply_subscribers set last_used_at=v_now,updated_at=v_now where workspace_id=p_workspace_id and id=p_subscriber_id;
 return true;
end $$;
create or replace function public.creator_reply_create_subscriber(
 p_workspace_id uuid,p_user_id uuid,p_subscriber_id uuid,p_conversation_id uuid,p_thread_id uuid,
 p_display_name text,p_platform text,p_platform_handle text,p_notes_ciphertext text,p_notes_key_version integer,
 p_checkpoint_ciphertext text,p_checkpoint_key_version integer)
returns table(subscriber_id uuid,conversation_id uuid) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from sirens_mind_creator_reply_workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then raise exception 'NOT_FOUND'; end if;
 insert into sirens_mind_creator_reply_subscribers(id,workspace_id,created_by_user_id,display_name,platform,platform_handle,notes_ciphertext,notes_key_version)
 values(p_subscriber_id,p_workspace_id,p_user_id,p_display_name,p_platform,p_platform_handle,p_notes_ciphertext,p_notes_key_version);
 insert into sirens_mind_creator_reply_conversations(id,workspace_id,subscriber_id,created_by_user_id,thread_id,status,checkpoint_ciphertext,checkpoint_key_version)
 values(p_conversation_id,p_workspace_id,p_subscriber_id,p_user_id,p_thread_id,'active',p_checkpoint_ciphertext,p_checkpoint_key_version);
 return query select p_subscriber_id,p_conversation_id;
end $$;
create or replace function public.creator_reply_new_conversation(
 p_workspace_id uuid,p_user_id uuid,p_subscriber_id uuid,p_conversation_id uuid,p_thread_id uuid,p_checkpoint_ciphertext text,p_checkpoint_key_version integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from sirens_mind_creator_reply_workspace_members m join sirens_mind_creator_reply_subscribers s on s.workspace_id=m.workspace_id where m.workspace_id=p_workspace_id and m.user_id=p_user_id and s.id=p_subscriber_id) then raise exception 'NOT_FOUND'; end if;
 update sirens_mind_creator_reply_conversations set status='paused',updated_at=now() where workspace_id=p_workspace_id and subscriber_id=p_subscriber_id and status='active';
 insert into sirens_mind_creator_reply_conversations(id,workspace_id,subscriber_id,created_by_user_id,thread_id,status,checkpoint_ciphertext,checkpoint_key_version)
 values(p_conversation_id,p_workspace_id,p_subscriber_id,p_user_id,p_thread_id,'active',p_checkpoint_ciphertext,p_checkpoint_key_version);
 return p_conversation_id;
end $$;
create or replace function public.creator_reply_resume_conversation(p_workspace_id uuid,p_user_id uuid,p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_subscriber_id uuid;
begin
 select c.subscriber_id into v_subscriber_id from sirens_mind_creator_reply_conversations c join sirens_mind_creator_reply_workspace_members m on m.workspace_id=c.workspace_id where c.workspace_id=p_workspace_id and c.id=p_conversation_id and m.user_id=p_user_id for update of c;
 if v_subscriber_id is null then raise exception 'NOT_FOUND'; end if;
 update sirens_mind_creator_reply_conversations set status='paused',updated_at=now() where workspace_id=p_workspace_id and subscriber_id=v_subscriber_id and status='active';
 update sirens_mind_creator_reply_conversations set status='active',archived_at=null,updated_at=now() where workspace_id=p_workspace_id and subscriber_id=v_subscriber_id and id=p_conversation_id;
 return v_subscriber_id;
end $$;
revoke all on function public.creator_reply_create_subscriber(uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,text,integer) from public,anon,authenticated;
revoke all on function public.creator_reply_new_conversation(uuid,uuid,uuid,uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.creator_reply_resume_conversation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.creator_reply_create_subscriber(uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,text,integer) to service_role;
grant execute on function public.creator_reply_new_conversation(uuid,uuid,uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.creator_reply_resume_conversation(uuid,uuid,uuid) to service_role;
