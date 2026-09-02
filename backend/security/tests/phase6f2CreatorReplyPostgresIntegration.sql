insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
do $$ declare w uuid; w2 uuid; s uuid; c uuid; ok boolean;
begin
 w:=public.ensure_creator_reply_workspace('10000000-0000-4000-8000-000000000001');
 assert w=public.ensure_creator_reply_workspace('10000000-0000-4000-8000-000000000001');
 w2:=public.ensure_creator_reply_workspace('10000000-0000-4000-8000-000000000002'); assert w<>w2;
 assert exists(select 1 from public.sirens_mind_creator_reply_workspace_members where workspace_id=w and role='owner');
 insert into public.sirens_mind_creator_reply_subscribers(workspace_id,created_by_user_id,display_name,platform) values(w,'10000000-0000-4000-8000-000000000001','Mike','OnlyFans') returning id into s;
 insert into public.sirens_mind_creator_reply_conversations(workspace_id,subscriber_id,created_by_user_id,status,checkpoint_ciphertext,checkpoint_key_version) values(w,s,'10000000-0000-4000-8000-000000000001','active','encrypted',1) returning id into c;
 begin insert into public.sirens_mind_creator_reply_conversations(workspace_id,subscriber_id,created_by_user_id,status,checkpoint_ciphertext,checkpoint_key_version) values(w,s,'10000000-0000-4000-8000-000000000001','active','encrypted',1);raise exception 'one active invariant failed';exception when unique_violation then null;end;
 ok:=public.creator_reply_save_checkpoint(w,s,c,0,'encrypted-v2',1);assert ok;assert not public.creator_reply_save_checkpoint(w,s,c,0,'stale',1);assert (select checkpoint_revision=1 and checkpoint_ciphertext='encrypted-v2' from public.sirens_mind_creator_reply_conversations where id=c);
 delete from public.sirens_mind_creator_reply_subscribers where id=s;assert not exists(select 1 from public.sirens_mind_creator_reply_conversations where id=c);
 assert (select relrowsecurity from pg_class where oid='public.sirens_mind_creator_reply_subscribers'::regclass);
end $$;
