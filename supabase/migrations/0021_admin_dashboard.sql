-- Kopor 0021: the full owner dashboard: every account, every business (with a detail page), money, AI use, and
-- announcements shown to everyone in the app. Only the admin Edge Function (service role, after checking
-- KOPOR_ADMIN_PHONES) can call the kopor_admin_* functions; every look at one business is written to admin_log.

-- Phone number from a Kopor sign-in address (p23276123456@phone.kopor.app -> 23276123456).
create or replace function kopor_phone_of(e text) returns text language sql immutable set search_path = public, pg_temp as $$
  select substring(e from '^p(\d+)@phone\.kopor\.app$')
$$;

-- Every account, newest first, with search by phone digits or name.
create or replace function kopor_admin_users(q text default '', lim int default 50, off int default 0) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with u as (
    select u.id, kopor_phone_of(u.email) as phone, u.raw_user_meta_data->>'name' as name, u.created_at, u.last_sign_in_at, u.banned_until
    from auth.users u
    -- Phone search ignores spaces and a leading 0 (076 123 456 finds 23276123456).
    where coalesce(q, '') = '' or kopor_phone_of(u.email) like '%' || regexp_replace(regexp_replace(q, '\D', '', 'g'), '^0', '') || '%' and regexp_replace(q, '\D', '', 'g') <> ''
       or (u.raw_user_meta_data->>'name') ilike '%' || q || '%'
  )
  select jsonb_build_object(
    'total', (select count(*) from u),
    'rows', coalesce((select jsonb_agg(r order by r.created_at desc) from (
      select u.*, (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role)), '[]'::jsonb)
                   from members m join orgs o on o.id = m.org_id where m.user_id = u.id and m.deleted = 0 and m.active = 1 and o.deleted = 0) as businesses
      from u order by u.created_at desc limit least(greatest(lim, 1), 200) offset greatest(off, 0)) r), '[]'::jsonb))
$$;

-- Every business with its size and how active it is. sort: new | active | records | name
create or replace function kopor_admin_orgs(q text default '', sort text default 'new', lim int default 50, off int default 0) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with month as (select (extract(epoch from now() - interval '30 days') * 1000)::bigint as ms),
  o as (
    select o.id, o.name, o.type, o.owner_name, o.phone, o.plan, o.plan_until, o.created_at,
      (select kopor_phone_of(email) from auth.users where id = o.owner_user_id) as owner_phone,
      (select count(*) from members m where m.org_id = o.id and m.deleted = 0 and m.active = 1) as staff,
      (select count(*) from branches b where b.org_id = o.id and b.deleted = 0) as branches,
      (select count(*) from transactions t where t.org_id = o.id and t.deleted = 0) as records,
      (select count(*) from transactions t, month where t.org_id = o.id and t.deleted = 0 and t.created_at > month.ms) as records_30d,
      (select coalesce(sum(t.amount), 0) from transactions t, month where t.org_id = o.id and t.deleted = 0 and t.type = 'in' and t.created_at > month.ms) as money_in_30d,
      (select max(t.created_at) from transactions t where t.org_id = o.id) as last_record,
      (select case when s.monime_space_id is not null then 'own' when s.easy_on then 'easy' end from org_secrets s where s.org_id = o.id) as payments
    from orgs o
    where o.deleted = 0 and (coalesce(q, '') = '' or o.name ilike '%' || q || '%' or o.owner_name ilike '%' || q || '%'
      or (regexp_replace(q, '\D', '', 'g') <> '' and o.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%'))
  )
  select jsonb_build_object(
    'total', (select count(*) from o),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select * from o order by
        case when sort = 'active' then coalesce(o.last_record, 0) end desc nulls last,
        case when sort = 'records' then o.records end desc nulls last,
        case when sort = 'name' then lower(o.name) end asc,
        o.created_at desc
      limit least(greatest(lim, 1), 200) offset greatest(off, 0)) r), '[]'::jsonb))
$$;

-- One business in detail: people, size, money, credit, recent activity, payments and AI use.
create or replace function kopor_admin_org(oid uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with month as (select (extract(epoch from now() - interval '30 days') * 1000)::bigint as ms)
  select jsonb_build_object(
    'org', (select jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type, 'owner_name', o.owner_name, 'phone', o.phone, 'address', o.address,
             'momo_number', o.momo_number, 'plan', o.plan, 'plan_until', o.plan_until, 'created_at', o.created_at,
             'owner_phone', (select kopor_phone_of(email) from auth.users where id = o.owner_user_id)) from orgs o where o.id = oid),
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'role', m.role, 'phone', m.phone, 'active', m.active = 1,
             'account', (select kopor_phone_of(email) from auth.users where id = m.user_id),
             'last_sign_in_at', (select last_sign_in_at from auth.users where id = m.user_id)) order by m.created_at)
             from members m where m.org_id = oid and m.deleted = 0), '[]'::jsonb),
    'branches', coalesce((select jsonb_agg(b.name order by b.created_at) from branches b where b.org_id = oid and b.deleted = 0), '[]'::jsonb),
    'counts', jsonb_build_object(
      'customers', (select count(*) from contacts c where c.org_id = oid and c.deleted = 0 and c.kind = 'customer'),
      'suppliers', (select count(*) from contacts c where c.org_id = oid and c.deleted = 0 and c.kind = 'supplier'),
      'products', (select count(*) from products p where p.org_id = oid and p.deleted = 0),
      'records', (select count(*) from transactions t where t.org_id = oid and t.deleted = 0),
      'invoices_unpaid', (select count(*) from invoices i where i.org_id = oid and i.deleted = 0 and i.status = 'unpaid'),
      'groups', (select count(*) from groups g where g.org_id = oid and g.deleted = 0)),
    'money_30d', jsonb_build_object(
      'in', (select coalesce(sum(amount), 0) from transactions t, month where t.org_id = oid and t.deleted = 0 and t.type = 'in' and t.created_at > month.ms),
      'out', (select coalesce(sum(amount), 0) from transactions t, month where t.org_id = oid and t.deleted = 0 and t.type = 'out' and t.created_at > month.ms)),
    -- What customers owe this business in total (credit given minus payments received).
    'credit_outstanding', (select coalesce(sum(case when type = 'gave' then amount else -amount end), 0) from ledger l where l.org_id = oid and l.deleted = 0),
    'activity_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'records',
             (select count(*) from transactions t where t.org_id = oid and t.created_at >= (extract(epoch from d) * 1000)::bigint
                and t.created_at < (extract(epoch from d + interval '1 day') * 1000)::bigint)) order by d), '[]'::jsonb)
             from generate_series(current_date - 13, current_date, interval '1 day') d),
    'audit', coalesce((select jsonb_agg(a order by a.at desc) from (select member_name, action, entity, summary, at from audit where org_id = oid order by at desc limit 25) a), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(p order by p.created_at desc) from (select kind, amount, status, note, created_at from payment_requests where org_id = oid order by created_at desc limit 20) p), '[]'::jsonb),
    'payments_mode', (select case when s.monime_space_id is not null then 'own' when s.easy_on then 'easy' end from org_secrets s where s.org_id = oid),
    'ai_14d', (select coalesce(sum(count), 0) from ai_usage where org_id = oid and day > current_date - 14))
$$;

-- Money through Monime across all businesses.
create or replace function kopor_admin_money() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with month as (select (extract(epoch from now() - interval '30 days') * 1000)::bigint as ms)
  select jsonb_build_object(
    'received_30d', (select coalesce(sum(amount), 0) from payment_requests, month where kind <> 'payout' and status = 'completed' and created_at > month.ms),
    'sent_30d', (select coalesce(sum(amount), 0) from payment_requests, month where kind = 'payout' and status = 'completed' and created_at > month.ms),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from payment_requests group by status) x),
    'own_accounts', (select count(*) from org_secrets where monime_space_id is not null),
    'easy_accounts', (select count(*) from org_secrets where easy_on and monime_space_id is null),
    'daily_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n',
             (select coalesce(sum(amount), 0) from payment_requests p where p.kind <> 'payout' and p.status = 'completed'
                and p.created_at >= (extract(epoch from d) * 1000)::bigint and p.created_at < (extract(epoch from d + interval '1 day') * 1000)::bigint)) order by d), '[]'::jsonb)
             from generate_series(current_date - 13, current_date, interval '1 day') d),
    'latest', coalesce((select jsonb_agg(r order by r.created_at desc) from (
             select p.kind, p.amount, p.status, p.note, p.created_at, o.name as business, o.id as org_id
             from payment_requests p join orgs o on o.id = p.org_id order by p.created_at desc limit 50) r), '[]'::jsonb))
$$;

-- AI use: requests per day, and which businesses use it most this week.
create or replace function kopor_admin_ai() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'daily_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
             'n', (select coalesce(sum(count), 0) from ai_usage where day = d::date) + (select coalesce(sum(count), 0) from ai_usage_anon where day = d::date)) order by d), '[]'::jsonb)
             from generate_series(current_date - 13, current_date, interval '1 day') d),
    'top_week', coalesce((select jsonb_agg(r order by r.n desc) from (
             select o.id as org_id, o.name, sum(a.count) as n from ai_usage a join orgs o on o.id = a.org_id
             where a.day > current_date - 7 group by o.id, o.name order by sum(a.count) desc limit 10) r), '[]'::jsonb),
    'guests_today', (select coalesce(sum(count), 0) from ai_usage_anon where day = current_date))
$$;

do $$ declare f text; begin
  foreach f in array array['kopor_admin_users(text, int, int)', 'kopor_admin_orgs(text, text, int, int)', 'kopor_admin_org(uuid)', 'kopor_admin_money()', 'kopor_admin_ai()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Announcements: a short message from Kopor shown at the top of everyone's Home screen (new features, outages, tips).
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message text not null check (length(message) between 1 and 500),
  level text not null default 'info' check (level in ('info', 'warn')),
  active boolean not null default true,
  expires_at timestamptz,
  created_by text not null default ''
);
alter table announcements enable row level security;
revoke all on announcements from anon, authenticated;
-- Everything except who wrote it (created_by is the administrator's phone number).
grant select (id, created_at, message, level, active, expires_at) on announcements to anon, authenticated;
drop policy if exists announcements_read on announcements;
create policy announcements_read on announcements for select to anon, authenticated
  using (active and (expires_at is null or expires_at > now()));

-- Account lookup (Support) now also says whether the account is suspended.
create or replace function kopor_admin_account(e text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', u.id, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'name', u.raw_user_meta_data->>'name', 'banned_until', u.banned_until,
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
