-- Kopor 0029: keep less personal data. Runs once a day (from the daily reminders job). Deletes:
--   - guest AI counts after 3 days (the privacy policy promises they are deleted after a few days)
--   - business AI counts after 90 days, text-message logs after 180 days, daily run markers after 90 days
--   - unused phone-check codes after 30 days, and wrong-PIN locks that ended more than 30 days ago
create or replace function kopor_cleanup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n jsonb := '{}'::jsonb; c int;
begin
  delete from ai_usage_anon where day < current_date - 3;                         get diagnostics c = row_count; n := n || jsonb_build_object('ai_guest', c);
  delete from ai_usage where day < current_date - 90;                             get diagnostics c = row_count; n := n || jsonb_build_object('ai', c);
  delete from sms_log where at < now() - interval '180 days';                      get diagnostics c = row_count; n := n || jsonb_build_object('sms_log', c);
  delete from sms_runs where day < current_date - 90;
  delete from push_runs where day < current_date - 90;
  delete from phone_checks where verified_at is null and coalesce(last_sent, now()) < now() - interval '30 days';
                                                                                   get diagnostics c = row_count; n := n || jsonb_build_object('phone_codes', c);
  delete from pin_attempts where locked_until is not null and locked_until < now() - interval '30 days';
  return n;
end $$;
revoke all on function kopor_cleanup() from public, anon, authenticated;
grant execute on function kopor_cleanup() to service_role;
