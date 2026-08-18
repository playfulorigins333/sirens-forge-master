-- Infrastructure prerequisite only. Cron activation remains a separate operator action.
create extension if not exists pg_net with schema extensions;
