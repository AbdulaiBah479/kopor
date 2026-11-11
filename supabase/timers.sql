-- Timers that run inside the Supabase database (pg_cron), set up by the "Update the server" workflow after the
-- migrations (not a migration itself: the test database has no pg_cron). __URL__ and __KEY__ are filled in from the
-- repository variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the public app key, already inside the app).
-- Running this again replaces the timers with the same names.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Every minute: mobile money payments a customer had pulled back (Monime sends no message for them), so the owner
-- hears within about a minute. Only businesses that took a Monime payment in the last 14 days are checked this often.
select cron.schedule('kopor-reversals', '* * * * *', $job$
  select net.http_post(
    url := '__URL__/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer __KEY__', 'apikey', '__KEY__'),
    body := '{"action":"reversals","active":true}'::jsonb,
    timeout_milliseconds := 55000
  )
$job$);

-- Every 2 minutes: a text receipt to customers who just paid a debt (shops that switched receipts on).
select cron.schedule('kopor-receipts', '*/2 * * * *', $job$
  select net.http_post(
    url := '__URL__/functions/v1/sms',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer __KEY__', 'apikey', '__KEY__'),
    body := '{"action":"receipts"}'::jsonb,
    timeout_milliseconds := 55000
  )
$job$);

-- 9 pm Freetown time (UTC): businesses that sold today but nobody closed the day get a "day not closed" alert.
select cron.schedule('kopor-not-closed', '0 21 * * *', $job$
  select net.http_post(
    url := '__URL__/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer __KEY__', 'apikey', '__KEY__'),
    body := '{"action":"not-closed"}'::jsonb,
    timeout_milliseconds := 55000
  )
$job$);

-- 7 am on the 1st of each month: last month's report to every owner (sent once a month whatever calls it).
select cron.schedule('kopor-monthly', '0 7 1 * *', $job$
  select net.http_post(
    url := '__URL__/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer __KEY__', 'apikey', '__KEY__'),
    body := '{"action":"monthly"}'::jsonb,
    timeout_milliseconds := 55000
  )
$job$);

-- pg_net keeps a log of every call; keep only the last day.
select cron.schedule('kopor-net-cleanup', '17 3 * * *', $job$ delete from net._http_response where created < now() - interval '1 day' $job$);
