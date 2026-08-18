-- Roll back only the sole-admin founder verification bootstrap RPC.
-- This intentionally does not delete any creator verification or audit rows that may
-- have been created by an explicitly authorized invocation.

drop function if exists public.creator_publishing_bootstrap_sole_admin_founder_verification(uuid, text, text);
