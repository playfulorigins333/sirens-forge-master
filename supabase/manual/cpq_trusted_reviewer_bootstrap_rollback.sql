-- Roll back only the one-time trusted reviewer bootstrap RPC.
-- This does not delete or modify any reviewer or audit rows that may already exist.

drop function if exists public.creator_publishing_bootstrap_first_trusted_reviewer(uuid, uuid, text);
