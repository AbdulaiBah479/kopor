-- Kopor 0011: problem reports and complaints. Anyone (signed in or not, e.g. a customer on an invoice page) may send
-- one; nobody but the server can read them (the owner sees them in the Owner dashboard through the admin function).

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('bug', 'money', 'payment', 'account', 'abuse', 'suggestion', 'other')),
  message text not null check (length(message) between 5 and 4000),
  contact text not null default '' check (length(contact) <= 120),
  about text not null default '' check (length(about) <= 200),
  org_id uuid,
  user_id uuid default auth.uid(),
  app_info jsonb not null default '{}'::jsonb check (pg_column_size(app_info) < 4000),
  status text not null default 'new' check (status in ('new', 'seen', 'resolved')),
  reply text not null default ''
);
create index if not exists reports_status_idx on reports (status, created_at desc);
alter table reports enable row level security;
revoke all on reports from anon, authenticated;
grant insert on reports to anon, authenticated;
drop policy if exists reports_insert on reports;
create policy reports_insert on reports for insert to anon, authenticated
  with check (status = 'new' and reply = '' and (user_id is null or user_id = auth.uid()));

-- Flood guard: at most 30 new reports a minute across the whole service.
create or replace function kopor_reports_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from reports where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'errx.reportBusy';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists reports_guard on reports;
create trigger reports_guard before insert on reports for each row execute function kopor_reports_guard();

-- Owner dashboard: count of reports waiting.
create or replace function kopor_admin_reports_new() returns int language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from reports where status <> 'resolved'
$$;
revoke all on function kopor_admin_reports_new() from public, anon, authenticated;
grant execute on function kopor_admin_reports_new() to service_role;
