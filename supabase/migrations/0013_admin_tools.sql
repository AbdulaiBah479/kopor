-- Kopor 0013: back-office tools for whoever runs Kopor (Owner dashboard → Support). Only the admin Edge Function
-- (service role, after checking KOPOR_ADMIN_PHONES) can use any of this.

-- Every support action (unlock, recovery code, Pro change) is written down: who did it, to which account, when.
create table if not exists admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_phone text not null,
  action text not null,
  target text not null default '',
  detail text not null default ''
);
alter table admin_log enable row level security;
revoke all on admin_log from anon, authenticated;

-- One account by sign-in address: when it joined and last signed in, its businesses, and whether it is locked.
create or replace function kopor_admin_account(e text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', u.id, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'name', u.raw_user_meta_data->>'name',
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type, 'role', m.role, 'plan', o.plan, 'plan_until', o.plan_until,
               'records', (select count(*) from transactions t where t.org_id = o.id and t.deleted = 0),
               'last_record', (select max(t.created_at) from transactions t where t.org_id = o.id)) order by o.created_at)
      from members m join orgs o on o.id = m.org_id where m.user_id = u.id and m.deleted = 0 and m.active = 1 and o.deleted = 0), '[]'::jsonb),
    'locked_until', (select p.locked_until from pin_attempts p where p.key = 'acct:' || encode(sha256(convert_to(lower(e), 'UTF8')), 'hex')),
    'wrong_pins', (select p.fails from pin_attempts p where p.key = 'acct:' || encode(sha256(convert_to(lower(e), 'UTF8')), 'hex')),
    'has_recovery_code', exists (select 1 from recovery_codes r where r.user_id = u.id))
  from auth.users u where u.email = lower(e)
$$;
revoke all on function kopor_admin_account(text) from public, anon, authenticated;
grant execute on function kopor_admin_account(text) to service_role;

-- Daily activity for the last 14 days: businesses that recorded something, and how many records.
create or replace function kopor_admin_activity() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
           'active', (select count(distinct t.org_id) from transactions t
                      where t.created_at >= (extract(epoch from d) * 1000)::bigint and t.created_at < (extract(epoch from d + interval '1 day') * 1000)::bigint),
           'records', (select count(*) from transactions t
                      where t.created_at >= (extract(epoch from d) * 1000)::bigint and t.created_at < (extract(epoch from d + interval '1 day') * 1000)::bigint))
         order by d), '[]'::jsonb)
  from generate_series(current_date - 13, current_date, interval '1 day') d
$$;
revoke all on function kopor_admin_activity() from public, anon, authenticated;
grant execute on function kopor_admin_activity() to service_role;
