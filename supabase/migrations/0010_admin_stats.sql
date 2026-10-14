-- Kopor 0010: numbers for the app owner's dashboard (More → Owner dashboard). Only the admin Edge Function
-- (service role) can call this; it checks the caller's phone against KOPOR_ADMIN_PHONES first.
-- Aggregates only: no names, phone numbers or business records leave the database.

create or replace function kopor_admin_stats() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with week as (select (extract(epoch from now() - interval '7 days') * 1000)::bigint as ms)
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accounts_week', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'businesses', (select count(*) from orgs where deleted = 0),
    'businesses_active_week', (select count(distinct org_id) from transactions, week where created_at > week.ms),
    'staff', (select count(*) from members where deleted = 0 and active = 1 and role <> 'owner'),
    'pro', (select count(*) from orgs where deleted = 0 and plan = 'pro' and coalesce(plan_until, 0) > (extract(epoch from now()) * 1000)::bigint),
    'records_week', (select count(*) from transactions, week where created_at > week.ms),
    'money_recorded_week', (select coalesce(sum(amount), 0) from transactions, week where created_at > week.ms and type = 'in'),
    'ai_today', (select coalesce(sum(count), 0) from ai_usage where day = current_date) + (select coalesce(sum(count), 0) from ai_usage_anon where day = current_date),
    'payments_completed', (select count(*) from payment_requests where status = 'completed'),
    'locked_accounts', (select count(*) from pin_attempts where key like 'acct:%' and locked_until > now()),
    'signups_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n', (select count(*) from auth.users where created_at::date = d::date)) order by d), '[]'::jsonb)
                    from generate_series(current_date - 13, current_date, interval '1 day') d),
    'business_types', (select coalesce(jsonb_object_agg(type, n), '{}'::jsonb) from (select type, count(*) as n from orgs where deleted = 0 group by type) x)
  )
$$;
revoke all on function kopor_admin_stats() from public, anon, authenticated;
grant execute on function kopor_admin_stats() to service_role;
