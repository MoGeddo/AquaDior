-- EXAMPLE ONLY — do not run unchanged or commit real secrets.
-- First enable pg_cron, pg_net, and Supabase Vault for the reviewed project.
-- Store the actual URL and a freshly generated PUSH_DISPATCH_SECRET in Vault
-- from the Supabase SQL Editor (never in Git):
--
-- select vault.create_secret(
--   'https://<PROJECT-REF>.supabase.co/functions/v1/push-dispatch',
--   'aquadior_push_dispatch_url',
--   'AquaDior push dispatcher URL'
-- );
-- select vault.create_secret(
--   '<same random value configured as the Edge Function PUSH_DISPATCH_SECRET>',
--   'aquadior_push_dispatch_secret',
--   'AquaDior push dispatcher authentication secret'
-- );
--
-- Run this schedule only after PUSH-NOTIFICATIONS.sql and the Edge Function
-- are deployed. It drains the outbox every minute; it sends no messages by
-- itself unless app users have explicitly opted in on a device.

select cron.unschedule(jobid)
from cron.job
where jobname = 'aquadior-push-dispatch';

select cron.schedule(
  'aquadior-push-dispatch',
  '* * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'aquadior_push_dispatch_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'aquadior_push_dispatch_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $$
);
