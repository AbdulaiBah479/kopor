-- Kopor 0016: free reminder notifications (Web Push). No SMS costs: phones that opted in get a daily notification.
--   member scope: a group member (from the member link) is reminded when their contribution or loan repayment is due.
--   org scope:    a business owner/manager gets a short daily "to do" (payments to approve, loans due, overdue debts).
-- Everything here is read and written only by the push Edge Function (service role).

create table if not exists push_subscriptions (
  endpoint text primary key check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 80 and 100), auth text not null check (length(auth) between 16 and 30),
  scope text not null check (scope in ('member', 'org')), org_id uuid not null references orgs(id),
  group_id uuid, member_id text, user_id uuid, lang text not null default 'en' check (lang in ('en', 'kri', 'fr')),
  created_at timestamptz not null default now(), last_sent date
);
create index if not exists push_subscriptions_org on push_subscriptions (org_id);
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;

-- Server-made keys (the VAPID key pair for Web Push is created on first use, so no key ever sits in the code).
create table if not exists app_keys (name text primary key, value text not null, created_at timestamptz not null default now());
alter table app_keys enable row level security;
revoke all on app_keys from anon, authenticated;

-- One run per day, however many times the daily job is triggered.
create table if not exists push_runs (day date primary key, at timestamptz not null default now(), sent int not null default 0, failed int not null default 0);
alter table push_runs enable row level security;
revoke all on push_runs from anon, authenticated;

-- Round number of a group on a date, and whether a payment falls due that day (same calendar as the app).
create or replace function kopor_round_on(start_date date, frequency text, d date) returns int language sql immutable as $$
  select case when d < start_date then 0
    when frequency = 'daily' then (d - start_date) + 1
    when frequency = 'weekly' then (d - start_date) / 7 + 1
    else (extract(year from age(d, start_date)) * 12 + extract(month from age(d, start_date)))::int + 1 end
$$;
create or replace function kopor_due_on(start_date date, frequency text, d date) returns boolean language sql immutable as $$
  select d >= start_date and case
    when frequency = 'daily' then true
    when frequency = 'weekly' then (d - start_date) % 7 = 0
    else extract(day from d) = least(extract(day from start_date), extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))) end
$$;

-- What to tell each subscribed phone today. Facts only; the Edge Function turns them into words in the phone's language.
create or replace function kopor_push_digest(d date) returns table (
  endpoint text, p256dh text, auth text, lang text, scope text, org_name text, group_name text, token text,
  contribution_due bigint, loan_owes bigint, loan_due date, claims_pending int, loans_due int, debts_overdue int
) language sql stable security definer set search_path = public, pg_temp as $$
  -- Group members.
  select s.endpoint, s.p256dh, s.auth, s.lang, s.scope, o.name, g.name, g.public_token,
    case when kopor_due_on(g.start_date, g.frequency, d)
          and (g.kind <> 'osusu' or kopor_round_on(g.start_date, g.frequency, d) <= jsonb_array_length(g.members))
          and not exists (select 1 from contributions c where c.group_id = g.id and c.deleted = 0 and c.member_id::text = s.member_id
                          and c.round = kopor_round_on(g.start_date, g.frequency, d))
         then g.amount else 0 end,
    coalesce(l.owes, 0), l.due, 0, 0, 0
  from push_subscriptions s
  join groups g on g.id = s.group_id and g.deleted = 0
  join orgs o on o.id = g.org_id and o.deleted = 0
  left join lateral (
    select sum(case when x.type = 'loan' then x.amount + x.interest else -x.amount end) as owes,
           min(x.due_date) filter (where x.type = 'loan') as due
    from group_loans x where x.group_id = g.id and x.deleted = 0 and x.member_id::text = s.member_id
  ) l on true
  where s.scope = 'member' and s.member_id is not null
    and exists (select 1 from jsonb_array_elements(g.members) m where m->>'id' = s.member_id)
  union all
  -- Business owners and managers.
  select s.endpoint, s.p256dh, s.auth, s.lang, s.scope, o.name, null, null, 0, 0, null,
    (select count(*)::int from group_claims c where c.org_id = o.id and c.deleted = 0 and c.status = 'pending'),
    (select count(*)::int from (
       select x.group_id, x.member_id, sum(case when x.type = 'loan' then x.amount + x.interest else -x.amount end) as owes,
              min(x.due_date) filter (where x.type = 'loan') as due
       from group_loans x where x.org_id = o.id and x.deleted = 0 group by x.group_id, x.member_id) q
     where q.owes > 0 and q.due <= d),
    (select count(*)::int from contacts ct where ct.org_id = o.id and ct.deleted = 0
       and (select coalesce(sum(case when e.type = 'gave' then e.amount else -e.amount end), 0) from ledger e where e.contact_id = ct.id and e.deleted = 0) > 0
       and exists (select 1 from ledger e where e.contact_id = ct.id and e.deleted = 0 and e.type = 'gave' and e.due_date < d))
  from push_subscriptions s join orgs o on o.id = s.org_id and o.deleted = 0
  where s.scope = 'org'
$$;
revoke all on function kopor_push_digest(date) from public, anon, authenticated;
grant execute on function kopor_push_digest(date) to service_role;
