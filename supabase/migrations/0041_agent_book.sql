-- Kopor 0041: mobile money agent book. Many shops are also Orange Money, Afrimoney or QMoney agents. The agent keeps
-- cash and "float" (e-money) per network; every deposit or withdrawal moves money between the two. Kopor keeps the
-- record and, when the balances are checked against the phones and the drawer, shows any money missing.
-- Record-keeping only: the money itself stays on the agent's SIMs and in the agent's drawer.
create table if not exists agent_moves (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, date date not null,
  -- deposit: customer gives cash, agent sends e-money. withdraw: agent gives cash, receives e-money.
  -- commission: the network pays the agent (into the float). buy_float / sell_float: cash swapped for float with a
  -- super-agent or bank. count: the real balance read from the phone or counted in the drawer.
  kind text not null check (kind in ('deposit', 'withdraw', 'commission', 'buy_float', 'sell_float', 'count')),
  -- Which balance: a network's float, or 'cash' (only for counts; the other kinds always name a network).
  network text not null check (network in ('orange', 'afrimoney', 'qmoney', 'cash')),
  amount bigint not null check (amount >= 0), phone text not null default '', note text not null default '',
  check (kind = 'count' or (network <> 'cash' and amount > 0))
);
create index if not exists agent_moves_rev on agent_moves (org_id, rev);

-- Same rules as the cash book: revisions, members only, cashiers record (and fix their own), only managers delete,
-- and cashiers cannot put records on another day.
drop trigger if exists agent_moves_write on agent_moves;
create trigger agent_moves_write before insert or update on agent_moves for each row execute function kopor_before_write();
alter table agent_moves enable row level security;
drop policy if exists agent_moves_select on agent_moves;
create policy agent_moves_select on agent_moves for select using (kopor_level(org_id) >= 0);
drop policy if exists agent_moves_insert on agent_moves;
create policy agent_moves_insert on agent_moves for insert with check (kopor_level(org_id) >= 1);
drop policy if exists agent_moves_update on agent_moves;
create policy agent_moves_update on agent_moves for update
  using (kopor_level(org_id) >= 2 or (kopor_level(org_id) >= 1 and created_by in (select kopor_member_ids(org_id))))
  with check (kopor_level(org_id) >= 1);
drop trigger if exists agent_moves_no_delete on agent_moves;
create trigger agent_moves_no_delete before update on agent_moves for each row execute function kopor_no_cashier_delete();
drop trigger if exists agent_moves_no_backdate on agent_moves;
create trigger agent_moves_no_backdate before insert on agent_moves for each row execute function kopor_no_backdate();
