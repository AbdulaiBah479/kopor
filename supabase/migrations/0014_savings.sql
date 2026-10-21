-- Kopor 0014: savings features (in the spirit of MiKashBoks), as RECORD-KEEPING only. Kopor never holds, moves or
-- lends money (that needs a Bank of Sierra Leone licence): the money stays in the group's box / the person's own
-- mobile money or bank, and Kopor keeps the books.
--   1) Savings & loan groups (VSLA): members save, borrow from the pot with interest set by the group, repay, share out.
--   2) Group target (e.g. a building fund) and a member link (members see balances on their own phones).
--   3) Savings goals ("cashbox"): money set aside for rent, restock, school fees...

-- 1 + 2) Groups: new kind 'savings', an optional target, loan rules and a secret member-link token.
alter table groups drop constraint if exists groups_kind_check;
alter table groups add constraint groups_kind_check check (kind in ('osusu', 'dues', 'savings'));
alter table groups
  add column if not exists target bigint check (target is null or target > 0),
  add column if not exists loan_interest numeric not null default 10 check (loan_interest >= 0 and loan_interest <= 100),
  add column if not exists public_token text unique check (public_token is null or length(public_token) >= 16);

-- Loans from a group's pot and their repayments (append-only rows: offline phones never conflict).
create table if not exists group_loans (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  group_id uuid not null, member_id uuid not null, type text not null check (type in ('loan', 'repay')),
  amount bigint not null check (amount > 0), interest bigint not null default 0 check (interest >= 0),
  date date not null, due_date date, note text not null default ''
);

-- 3) Savings goals and the money put in / taken out.
create table if not exists savings_goals (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  name text not null check (length(name) between 1 and 80), target bigint not null check (target > 0),
  due_date date, kept_in text not null default 'cash', archived smallint not null default 0
);
create table if not exists savings_moves (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  goal_id uuid not null, amount bigint not null check (amount <> 0), date date not null, note text not null default ''
);

create index if not exists group_loans_rev on group_loans (org_id, rev);
create index if not exists savings_goals_rev on savings_goals (org_id, rev);
create index if not exists savings_moves_rev on savings_moves (org_id, rev);

-- Same rules as the rest of the books: revisions, last-writer-wins, members only, managers lend, cashiers record.
do $$
declare r record;
begin
  for r in select * from (values ('group_loans', 2, 2), ('savings_goals', 1, 1), ('savings_moves', 1, 2)) as x(tbl, ins, upd) loop
    execute format('drop trigger if exists %I on %I', r.tbl || '_write', r.tbl);
    execute format('create trigger %I before insert or update on %I for each row execute function kopor_before_write()', r.tbl || '_write', r.tbl);
    execute format('alter table %I enable row level security', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_select', r.tbl);
    execute format('create policy %I on %I for select using (kopor_level(org_id) >= 0)', r.tbl || '_select', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_insert', r.tbl);
    execute format('create policy %I on %I for insert with check (kopor_level(org_id) >= %s)', r.tbl || '_insert', r.tbl, r.ins);
    execute format('drop policy if exists %I on %I', r.tbl || '_update', r.tbl);
    execute format('create policy %I on %I for update using (kopor_level(org_id) >= %s or (kopor_level(org_id) >= %s and created_by in (select kopor_member_ids(org_id)))) with check (kopor_level(org_id) >= %s)',
      r.tbl || '_update', r.tbl, r.upd, least(r.ins, r.upd), least(r.ins, r.upd));
  end loop;
end $$;
drop trigger if exists group_loans_no_delete on group_loans;
create trigger group_loans_no_delete before update on group_loans for each row execute function kopor_no_cashier_delete();
drop trigger if exists savings_moves_no_delete on savings_moves;
create trigger savings_moves_no_delete before update on savings_moves for each row execute function kopor_no_cashier_delete();

-- Member link: what a group member sees from the link the organiser shares. Names only (never phone numbers),
-- each member's saved total, loan still owed, this round's payment, and the group's totals.
create or replace function public_group(token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', g.name, 'kind', g.kind, 'amount', g.amount, 'frequency', g.frequency, 'start_date', g.start_date, 'target', g.target,
    'loan_interest', g.loan_interest, 'payouts', g.payouts, 'org_name', o.name, 'currency', o.currency, 'momo_number', o.momo_number,
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m->>'id', 'name', m->>'name',
        'saved', coalesce((select sum(c.amount) from contributions c where c.group_id = g.id and c.deleted = 0 and c.member_id::text = m->>'id'), 0),
        'rounds', coalesce((select jsonb_agg(distinct c.round) from contributions c where c.group_id = g.id and c.deleted = 0 and c.member_id::text = m->>'id'), '[]'::jsonb),
        'owes', coalesce((select sum(case when l.type = 'loan' then l.amount + l.interest else -l.amount end) from group_loans l
                          where l.group_id = g.id and l.deleted = 0 and l.member_id::text = m->>'id'), 0),
        'next_due', (select min(l.due_date) from group_loans l where l.group_id = g.id and l.deleted = 0 and l.type = 'loan' and l.member_id::text = m->>'id')
      ) order by ord) from jsonb_array_elements(g.members) with ordinality as t(m, ord)), '[]'::jsonb),
    'saved_total', coalesce((select sum(c.amount) from contributions c where c.group_id = g.id and c.deleted = 0), 0),
    'lent_out', coalesce((select sum(case when l.type = 'loan' then l.amount + l.interest else -l.amount end) from group_loans l where l.group_id = g.id and l.deleted = 0), 0),
    'interest_earned', coalesce((select sum(l.interest) from group_loans l where l.group_id = g.id and l.deleted = 0 and l.type = 'loan'), 0))
  from groups g join orgs o on o.id = g.org_id
  where length(token) >= 16 and g.public_token = token and g.deleted = 0 and o.deleted = 0
$$;
revoke all on function public_group(text) from public;
grant execute on function public_group(text) to anon, authenticated;
