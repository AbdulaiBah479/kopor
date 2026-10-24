-- Kopor 0022: staff attendance and salaries.
--   attendance:   one row per staff member per day (the app makes the id from member + date, so two phones marking the
--                 same person offline update one row instead of making two). Staff can tap in only for themselves;
--                 managers and owners can mark anyone.
--   staff_terms:  each person's pay (monthly salary or daily rate, working days a week). Owners set it.
--   staff_pay:    advances, salary payments, bonuses and deductions. Pay is private: only managers and owners see
--                 staff_terms and staff_pay; cashiers and viewers cannot read anyone's salary.

create table if not exists attendance (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  member_id uuid not null, date date not null,
  status text not null check (status in ('present', 'late', 'half', 'absent', 'leave', 'off')),
  time_in text check (time_in is null or time_in ~ '^\d{2}:\d{2}$'), time_out text check (time_out is null or time_out ~ '^\d{2}:\d{2}$'),
  note text not null default '' check (length(note) <= 200)
);
create table if not exists staff_terms (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  member_id uuid not null, pay_type text not null default 'monthly' check (pay_type in ('monthly', 'daily')),
  amount bigint not null check (amount >= 0), work_days smallint not null default 6 check (work_days between 1 and 7),
  start_date date
);
create table if not exists staff_pay (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  member_id uuid not null, kind text not null check (kind in ('advance', 'salary', 'bonus', 'deduction')),
  amount bigint not null check (amount > 0), month text not null check (month ~ '^\d{4}-\d{2}$'), date date not null,
  note text not null default '' check (length(note) <= 200), txn_id uuid
);
create index if not exists attendance_rev on attendance (org_id, rev);
create index if not exists staff_terms_rev on staff_terms (org_id, rev);
create index if not exists staff_pay_rev on staff_pay (org_id, rev);

do $$
declare t text;
begin
  foreach t in array array['attendance', 'staff_terms', 'staff_pay'] loop
    execute format('drop trigger if exists %I on %I', t || '_write', t);
    execute format('create trigger %I before insert or update on %I for each row execute function kopor_before_write()', t || '_write', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
  end loop;
end $$;

-- Attendance: everyone in the business can see the register; staff write only their own row, managers anyone's.
create policy attendance_select on attendance for select using (kopor_level(org_id) >= 0);
create policy attendance_insert on attendance for insert
  with check (kopor_level(org_id) >= 2 or (kopor_level(org_id) >= 1 and member_id in (select kopor_member_ids(org_id))));
create policy attendance_update on attendance for update
  using (kopor_level(org_id) >= 2 or (kopor_level(org_id) >= 1 and member_id in (select kopor_member_ids(org_id))))
  with check (kopor_level(org_id) >= 2 or (kopor_level(org_id) >= 1 and member_id in (select kopor_member_ids(org_id))));

-- Pay: managers and owners only. Owners set the terms; managers record advances and salary payments.
create policy staff_terms_select on staff_terms for select using (kopor_level(org_id) >= 2);
create policy staff_terms_insert on staff_terms for insert with check (kopor_level(org_id) >= 3);
create policy staff_terms_update on staff_terms for update using (kopor_level(org_id) >= 3) with check (kopor_level(org_id) >= 3);
create policy staff_pay_select on staff_pay for select using (kopor_level(org_id) >= 2);
create policy staff_pay_insert on staff_pay for insert with check (kopor_level(org_id) >= 2);
create policy staff_pay_update on staff_pay for update using (kopor_level(org_id) >= 2) with check (kopor_level(org_id) >= 2);
