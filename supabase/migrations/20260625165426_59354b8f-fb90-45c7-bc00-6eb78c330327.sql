DO $$
DECLARE
  _jobid bigint;
BEGIN
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = 'cron-follow-ups-hourly';
  IF _jobid IS NOT NULL THEN
    PERFORM cron.unschedule(_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'cron-follow-ups-hourly',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jbzctydskdpzrejvpwpn.supabase.co/functions/v1/cron-follow-ups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := jsonb_build_object('cron', true, 'time', now())
  );
  $$
);