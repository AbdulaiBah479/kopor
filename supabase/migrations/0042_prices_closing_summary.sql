-- Kopor 0042: supplier price watch and the closing summary.
--
-- 1) Price watch: each restock remembers what one item cost and who sold it, so Kopor can warn "rice went up 15%
--    since your last purchase" and suggest a new selling price (domain/prices.ts).
alter table stock_moves add column if not exists unit_cost bigint check (unit_cost is null or unit_cost >= 0);
alter table stock_moves add column if not exists supplier text not null default '';

-- 2) Closing summary: when a cashier or manager closes the day, the owner gets one message with the day's sales,
--    profit, cash short or over, what customers owe and the warnings of the day, even when far from the shop.
--    It goes out through the alerts sender (kind 'closing'), but it is not a fraud warning: the app leaves it out of
--    Fraud watch, and the weekly report does not count it.
alter table alerts drop constraint if exists alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('short', 'deleted', 'away', 'left', 'fake', 'refund', 'approval', 'newDevice', 'test', 'reversal', 'closing'));

create or replace function kopor_day_summary(o uuid, d date, b uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sales', coalesce(sum(case when x.type = 'in' and x.category <> 'refund' then x.amount else 0 end), 0),
    'expenses', coalesce(sum(case when x.type = 'out' then x.amount else 0 end), 0),
    'cost', coalesce(sum(case when x.type = 'in' then coalesce((select sum((i->>'qty')::numeric * coalesce((i->>'cost')::numeric, 0)) from jsonb_array_elements(x.items) i), 0) else 0 end), 0)::bigint,
    'owed', coalesce((select sum(case when l.type = 'gave' then l.amount else -l.amount end) from ledger l join contacts c on c.id = l.contact_id
                      where l.org_id = o and l.deleted = 0 and coalesce(c.kind, 'customer') <> 'supplier'), 0),
    'warnings', (select count(*) from alerts a where a.org_id = o and a.at::date = d and a.kind not in ('closing', 'test')))
  from transactions x where x.org_id = o and x.deleted = 0 and x.date = d and (b is null or x.branch_id = b)
$$;
revoke all on function kopor_day_summary(uuid, date, uuid) from public, anon, authenticated;

create or replace function kopor_alert_day_closed() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
  if new.deleted = 0 and new.kind = 'close' then
    s := kopor_day_summary(new.org_id, new.date, new.branch_id)
      || jsonb_build_object('diff', new.difference, 'date', new.date, 'branch', coalesce((select name from branches where id = new.branch_id), ''));
    perform kopor_alert(new.org_id, 'closing', new.id::text, kopor_member_name(new.created_by), new.counted, s::text);
  end if;
  return new;
end $$;
drop trigger if exists closings_day_summary on closings;
create trigger closings_day_summary after insert on closings for each row execute function kopor_alert_day_closed();

-- The weekly report counts warnings only (not closing summaries or test messages).
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
            where alerts.org_id = t.org_id and at >= s and at < s + 7 and kind not in ('closing', 'test') group by who) w), '[]'::jsonb)
  from t join orgs o on o.id = t.org_id where o.deleted = 0
$$;
revoke all on function kopor_weekly_report(date) from public, anon, authenticated;
grant execute on function kopor_weekly_report(date) to service_role;
