
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'process-scheduled-outbox-every-minute';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'process-scheduled-outbox-every-minute',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jbzctydskdpzrejvpwpn.supabase.co/functions/v1/process-scheduled-outbox',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('source','cron')
  );
  $cron$
);
