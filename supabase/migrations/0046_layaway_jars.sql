-- Kopor 0046: pay small-small (layaway) and money jars.
--
-- 1) Pay small-small: a customer pays in parts towards goods the shop keeps for them, and collects them when fully
--    paid. The plan is a row here; each payment is an ordinary credit-book entry ("got", ref_type 'layaway', ref_id
--    = the plan), so it shows on the customer's page and at closing with money received. Collecting records the sale.
create table if not exists layaways (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, contact_id uuid not null, item text not null check (length(item) between 1 and 120),
  product_id uuid, qty numeric not null default 1 check (qty > 0), total bigint not null check (total > 0),
  date date not null, due_date date, status text not null default 'open' check (status in ('open', 'collected', 'cancelled')),
  txn_id uuid
);
create index if not exists layaways_rev on layaways (org_id, rev);

drop trigger if exists layaways_write on layaways;
create trigger layaways_write before insert or update on layaways for each row execute function kopor_before_write();
alter table layaways enable row level security;
drop policy if exists layaways_select on layaways;
create policy layaways_select on layaways for select using (kopor_level(org_id) >= 0);
drop policy if exists layaways_insert on layaways;
create policy layaways_insert on layaways for insert with check (kopor_level(org_id) >= 1);
drop policy if exists layaways_update on layaways;
create policy layaways_update on layaways for update
  using (kopor_level(org_id) >= 2 or (kopor_level(org_id) >= 1 and created_by in (select kopor_member_ids(org_id))))
  with check (kopor_level(org_id) >= 1);
drop trigger if exists layaways_no_delete on layaways;
create trigger layaways_no_delete before update on layaways for each row execute function kopor_no_cashier_delete();
drop trigger if exists layaways_no_backdate on layaways;
create trigger layaways_no_backdate before insert on layaways for each row execute function kopor_no_backdate();

-- 2) Money jars: a savings goal can take a share of each day's sales, suggested when the day is closed.
alter table savings_goals add column if not exists auto_pct numeric check (auto_pct is null or (auto_pct > 0 and auto_pct <= 100));
