-- Kopor 0048: more things Kopor does by itself.
--
-- 1) "Day not closed": at 9 pm the server looks for businesses that sold today but nobody counted the drawer, and
--    alerts the owner (a common way money goes missing). Kind 'notClosed' (supabase/functions/push, not-closed).
alter table alerts drop constraint if exists alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('short', 'deleted', 'away', 'left', 'fake', 'refund', 'approval', 'newDevice', 'test', 'reversal', 'closing', 'notClosed'));

create or replace function kopor_not_closed(d date) returns table (org_id uuid, branch_id uuid, sales bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.org_id, x.branch_id, sum(x.amount)::bigint
  from transactions x join orgs o on o.id = x.org_id and o.deleted = 0
  where x.deleted = 0 and x.date = d and x.type = 'in' and x.category <> 'refund'
    and not exists (select 1 from closings c where c.org_id = x.org_id and c.deleted = 0 and c.date = d and c.kind = 'close'
                    and (c.branch_id is not distinct from x.branch_id))
  group by x.org_id, x.branch_id
$$;
revoke all on function kopor_not_closed(date) from public, anon, authenticated;
grant execute on function kopor_not_closed(date) to service_role;

-- 2) Payment receipts by SMS: when a customer pays a debt, the shop's phone texts them what was received and what is
--    left (only for shops that switch it on). Each payment is texted once.
alter table org_secrets add column if not exists sms_receipts boolean not null default false;
create table if not exists sms_receipted (ledger_id uuid primary key, org_id uuid not null, at timestamptz not null default now());
alter table sms_receipted enable row level security;
revoke all on sms_receipted from anon, authenticated;
alter table sms_log drop constraint if exists sms_log_kind_check;
alter table sms_log add constraint sms_log_kind_check check (kind in ('reminder', 'balance', 'test', 'alert', 'weekly', 'broadcast', 'receipt', 'dueSoon'));

-- 3) Monthly report on the 1st: last month's sales, expenses, cost of goods and profit, with the month before.
create table if not exists monthly_runs (month date primary key, sent int not null default 0, at timestamptz not null default now());
alter table monthly_runs enable row level security;
revoke all on monthly_runs from anon, authenticated;

create or replace function kopor_period_totals(o uuid, s date, e date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sales', coalesce(sum(case when x.type = 'in' and x.category <> 'refund' then x.amount else 0 end), 0),
    'expenses', coalesce(sum(case when x.type = 'out' and x.category not in ('stock', 'refund', 'reversal') then x.amount else 0 end), 0),
    'cost', coalesce(sum(case when x.type = 'in' then coalesce((select sum((i->>'qty')::numeric * coalesce((i->>'cost')::numeric, 0)) from jsonb_array_elements(x.items) i), 0) else 0 end), 0)::bigint)
  from transactions x where x.org_id = o and x.deleted = 0 and x.date >= s and x.date < e
$$;
revoke all on function kopor_period_totals(uuid, date, date) from public, anon, authenticated;

create or replace function kopor_month_report(s date) returns table (org_id uuid, name text, this_month jsonb, last_month jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.name, kopor_period_totals(o.id, s, (s + interval '1 month')::date), kopor_period_totals(o.id, (s - interval '1 month')::date, s)
  from orgs o
  where o.deleted = 0 and exists (select 1 from transactions x where x.org_id = o.id and x.deleted = 0 and x.date >= s and x.date < (s + interval '1 month')::date)
$$;
revoke all on function kopor_month_report(date) from public, anon, authenticated;
grant execute on function kopor_month_report(date) to service_role;

-- 4) "Unusual day": the closing summary also carries the usual sales for this weekday (average of the last 4).
create or replace function kopor_day_summary(o uuid, d date, b uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sales', coalesce(sum(case when x.type = 'in' and x.category <> 'refund' then x.amount else 0 end), 0),
    'expenses', coalesce(sum(case when x.type = 'out' then x.amount else 0 end), 0),
    'cost', coalesce(sum(case when x.type = 'in' then coalesce((select sum((i->>'qty')::numeric * coalesce((i->>'cost')::numeric, 0)) from jsonb_array_elements(x.items) i), 0) else 0 end), 0)::bigint,
    'owed', coalesce((select sum(case when l.type = 'gave' then l.amount else -l.amount end) from ledger l join contacts c on c.id = l.contact_id
                      where l.org_id = o and l.deleted = 0 and coalesce(c.kind, 'customer') <> 'supplier'), 0),
    'warnings', (select count(*) from alerts a where a.org_id = o and a.at::date = d and a.kind not in ('closing', 'test')),
    'usual', (select coalesce(round(avg(day_sales)), 0) from (
                select sum(y.amount) as day_sales from transactions y
                where y.org_id = o and y.deleted = 0 and y.type = 'in' and y.category <> 'refund' and (b is null or y.branch_id = b)
                  and y.date in (d - 7, d - 14, d - 21, d - 28)
                group by y.date) w))
  from transactions x where x.org_id = o and x.deleted = 0 and x.date = d and (b is null or x.branch_id = b)
$$;
revoke all on function kopor_day_summary(uuid, date, uuid) from public, anon, authenticated;

-- The weekly report counts warnings about people only (not the "day not closed" reminder).
create or replace function kopor_weekly_report(s date) returns table (
  org_id uuid, name text, sales bigint, expenses bigint, cost bigint, records int, people jsonb, warnings jsonb
) language sql stable security definer set search_path = public, pg_temp as $$
  with t as (
    select x.org_id,
      sum(case when x.type = 'in' and x.category <> 'refund' then x.amount else 0 end)::bigint as sales,
      sum(case when x.type = 'out' then x.amount else 0 end)::bigint as expenses,
      sum(case when x.type = 'in' then coalesce((select sum((i->>'qty')::numeric * coalesce((i->>'cost')::numeric, 0)) from jsonb_array_elements(x.items) i), 0) else 0 end)::bigint as cost,
      count(*)::int as records
    from transactions x where x.deleted = 0 and x.date >= s and x.date < s + 7 group by x.org_id
  )
  select t.org_id, o.name, t.sales, t.expenses, t.cost, t.records,
    coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'late', a.late, 'absent', a.absent) order by a.late desc, a.absent desc)
      from (select member_id, count(*) filter (where status = 'late') as late, count(*) filter (where status = 'absent') as absent
            from attendance where attendance.org_id = t.org_id and deleted = 0 and date >= s and date < s + 7 group by member_id) a
      join members m on m.id = a.member_id where a.late + a.absent > 0), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('who', w.who, 'n', w.n, 'amount', w.amount) order by w.n desc)
      from (select who, count(*) as n, sum(amount) as amount from alerts
            where alerts.org_id = t.org_id and at >= s and at < s + 7 and kind not in ('closing', 'test', 'notClosed') group by who) w), '[]'::jsonb)
  from t join orgs o on o.id = t.org_id where o.deleted = 0
$$;
revoke all on function kopor_weekly_report(date) from public, anon, authenticated;
grant execute on function kopor_weekly_report(date) to service_role;
