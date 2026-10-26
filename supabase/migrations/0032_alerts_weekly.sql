-- Kopor 0032: instant fraud alerts, the weekly report, and the credit limit enforced on the server.
--
-- alerts: made by the database itself when a record arrives (so a phone cannot skip or fake one):
--   short     a day closed with cash (or mobile money) short
--   deleted   a sale or credit entry deleted by someone who is not the owner
--   away      a worker tapped in far from the shop
--   left      a worker sharing live location went outside the shop area (at most once an hour per person)
--   fake      a position came from a fake-GPS app (once a day per person)
-- The push function sends new alerts to owners and managers (phone notification, and a text from the shop's phone
-- when text messages are connected) and marks them sent. Owners and managers can read them; others cannot.

create table if not exists alerts (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('short', 'deleted', 'away', 'left', 'fake')),
  ref text not null,
  who text not null default '',
  amount bigint not null default 0,
  detail text not null default '',
  at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, kind, ref)
);
create index if not exists alerts_unsent on alerts (at) where sent_at is null;
create index if not exists alerts_org_at on alerts (org_id, at desc);
alter table alerts enable row level security;
drop policy if exists alerts_select on alerts;
create policy alerts_select on alerts for select using (kopor_level(org_id) >= 2);
revoke insert, update, delete on alerts from anon, authenticated;
grant select on alerts to authenticated;

create or replace function kopor_alert(o uuid, k text, r text, w text, a bigint, d text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into alerts (org_id, kind, ref, who, amount, detail) values (o, k, r, coalesce(w, ''), coalesce(a, 0), coalesce(d, ''))
  on conflict (org_id, kind, ref) do nothing;
$$;
revoke all on function kopor_alert(uuid, text, text, text, bigint, text) from public, anon, authenticated;

create or replace function kopor_member_name(m uuid) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select name from members where id = m
$$;
revoke all on function kopor_member_name(uuid) from public, anon;

-- Distance in metres between two points (haversine), the same maths as the app.
create or replace function kopor_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- A day closed short (cash, or any mobile money network).
create or replace function kopor_alert_closing() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare momo bigint := 0; k text; v jsonb;
begin
  for k, v in select * from jsonb_each(coalesce(new.momo, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'object' and (v->>'expected')::bigint > (v->>'counted')::bigint then
      momo := momo + (v->>'expected')::bigint - (v->>'counted')::bigint;
    end if;
  end loop;
  if new.deleted = 0 and (new.difference < 0 or momo > 0) then
    perform kopor_alert(new.org_id, 'short', new.id::text, kopor_member_name(new.created_by), greatest(0, -new.difference) + momo,
      new.date::text || case when momo > 0 then ' momo' else '' end);
  end if;
  return new;
end $$;
drop trigger if exists closings_alert on closings;
create trigger closings_alert after insert on closings for each row execute function kopor_alert_closing();

-- A sale or credit entry deleted by anyone but the owner.
create or replace function kopor_alert_deleted() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare by_name text;
begin
  if old.deleted = 0 and new.deleted = 1 and kopor_level(new.org_id) between 0 and 2 then
    select name into by_name from members where org_id = new.org_id and user_id = auth.uid() and deleted = 0 limit 1;
    perform kopor_alert(new.org_id, 'deleted', new.id::text, by_name, new.amount, tg_table_name);
  end if;
  return new;
end $$;
drop trigger if exists transactions_alert on transactions;
create trigger transactions_alert after update on transactions for each row execute function kopor_alert_deleted();
drop trigger if exists ledger_alert on ledger;
create trigger ledger_alert after update on ledger for each row execute function kopor_alert_deleted();

-- Tapped in far from the shop.
create or replace function kopor_alert_tapin() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare lim int;
begin
  select coalesce(away_m, 200) into lim from orgs where id = new.org_id;
  if new.where_m is not null and new.where_m > lim and new.time_in is not null then
    perform kopor_alert(new.org_id, 'away', new.id::text, kopor_member_name(new.member_id), 0, new.where_m::text);
  end if;
  return new;
end $$;
drop trigger if exists attendance_alert on attendance;
create trigger attendance_alert after insert or update of where_m on attendance for each row execute function kopor_alert_tapin();

-- Live location: outside the shop area (the position's own uncertainty is taken off first), or a fake-GPS app.
create or replace function kopor_alert_live() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare o record; d double precision;
begin
  if new.fake then
    perform kopor_alert(new.org_id, 'fake', new.member_id::text || ':' || to_char(new.at, 'YYYY-MM-DD'), kopor_member_name(new.member_id), 0, '');
  end if;
  select shop_lat, shop_lng, coalesce(away_m, 200) as lim into o from orgs where id = new.org_id;
  if o.shop_lat is null or new.accuracy > 1000 then return new; end if;
  d := kopor_distance_m(new.lat, new.lng, o.shop_lat, o.shop_lng) - new.accuracy;
  if d > o.lim then
    perform kopor_alert(new.org_id, 'left', new.member_id::text || ':' || to_char(new.at, 'YYYY-MM-DD-HH24'), kopor_member_name(new.member_id), 0, round(d)::text);
  end if;
  return new;
end $$;
drop trigger if exists staff_live_alert on staff_live;
create trigger staff_live_alert after insert or update on staff_live for each row execute function kopor_alert_live();

-- Credit limit on the server: a cashier cannot take one customer above it (managers and owners can).
create or replace function kopor_credit_limit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare lim bigint; owes bigint;
begin
  if new.type <> 'gave' or new.deleted = 1 or coalesce(auth.role(), '') = 'service_role' or kopor_level(new.org_id) not in (0, 1) then return new; end if;
  select credit_limit into lim from orgs where id = new.org_id;
  if lim is null then return new; end if;
  select coalesce(sum(case when type = 'gave' then amount else -amount end), 0) into owes
    from ledger where org_id = new.org_id and contact_id = new.contact_id and deleted = 0 and id <> new.id;
  if owes + new.amount > lim then
    raise exception 'err.creditLimit' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ledger_credit_limit on ledger;
create trigger ledger_credit_limit before insert on ledger for each row execute function kopor_credit_limit();

-- The weekly report for every business with records in the week [s, s + 7): money, staff attendance and warnings.
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
            where alerts.org_id = t.org_id and at >= s and at < s + 7 group by who) w), '[]'::jsonb)
  from t join orgs o on o.id = t.org_id where o.deleted = 0
$$;
revoke all on function kopor_weekly_report(date) from public, anon, authenticated;
grant execute on function kopor_weekly_report(date) to service_role;

create table if not exists weekly_runs (week date primary key, sent int not null default 0, at timestamptz not null default now());
alter table weekly_runs enable row level security;
revoke all on weekly_runs from anon, authenticated;

-- Old alerts are deleted after 180 days by the daily clean-up.
create or replace function kopor_cleanup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n jsonb := '{}'::jsonb; c int;
begin
  delete from ai_usage_anon where day < current_date - 3;                         get diagnostics c = row_count; n := n || jsonb_build_object('ai_guest', c);
  delete from ai_usage where day < current_date - 90;                             get diagnostics c = row_count; n := n || jsonb_build_object('ai', c);
  delete from sms_log where at < now() - interval '180 days';                      get diagnostics c = row_count; n := n || jsonb_build_object('sms_log', c);
  delete from sms_runs where day < current_date - 90;
  delete from push_runs where day < current_date - 90;
  delete from weekly_runs where week < current_date - 365;
  delete from phone_checks where verified_at is null and coalesce(last_sent, now()) < now() - interval '30 days';
                                                                                   get diagnostics c = row_count; n := n || jsonb_build_object('phone_codes', c);
  delete from pin_attempts where locked_until is not null and locked_until < now() - interval '30 days';
  delete from staff_track where at < now() - interval '30 days';                   get diagnostics c = row_count; n := n || jsonb_build_object('positions', c);
  delete from staff_live where at < now() - interval '30 days';
  delete from alerts where at < now() - interval '180 days';                       get diagnostics c = row_count; n := n || jsonb_build_object('alerts', c);
  return n;
end $$;
revoke all on function kopor_cleanup() from public, anon, authenticated;
grant execute on function kopor_cleanup() to service_role;

-- Alerts and the weekly report can also go out as texts from the shop's own phone.
alter table sms_log drop constraint if exists sms_log_kind_check;
alter table sms_log add constraint sms_log_kind_check check (kind in ('reminder', 'balance', 'test', 'alert', 'weekly'));
