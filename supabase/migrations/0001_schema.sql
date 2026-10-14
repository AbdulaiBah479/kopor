-- Kopor schema. Mirrors src/db/schema.ts. Timestamps are epoch milliseconds (bigint) written by the
-- client; `rev` is a server-assigned global revision used for incremental sync pulls.

create sequence if not exists kopor_rev;

-- Shared columns: id, org_id, created_at, updated_at, deleted, created_by, rev.
create table orgs (
  id uuid primary key, org_id uuid not null, created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  owner_user_id uuid default auth.uid(),
  name text not null check (length(name) between 1 and 120), type text not null default 'shop',
  currency text not null default 'Le', country_code text not null default '232', phone text not null default '',
  address text not null default '', momo_number text not null default '', owner_name text not null default '',
  reminder_days int not null default 2, plan text not null default 'free' check (plan in ('free', 'pro')),
  check (org_id = id)
);

create table branches (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  name text not null, address text not null default ''
);

create table members (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  user_id uuid, name text not null, phone text not null default '',
  role text not null check (role in ('owner', 'manager', 'cashier', 'viewer')),
  branch_id uuid, active smallint not null default 1
);

create table contacts (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  name text not null, phone text not null default '', kind text not null default 'customer' check (kind in ('customer', 'supplier')), notes text not null default ''
);

create table ledger (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, contact_id uuid not null, type text not null check (type in ('gave', 'got')), amount bigint not null check (amount > 0),
  note text not null default '', date date not null, due_date date, ref_type text, ref_id uuid
);

create table transactions (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, type text not null check (type in ('in', 'out')), category text not null, amount bigint not null check (amount > 0),
  method text not null, contact_id uuid, note text not null default '', date date not null, items jsonb not null default '[]',
  ledger_id uuid, invoice_id uuid
);

create table products (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  name text not null, sku text not null default '', unit text not null default 'pcs', price bigint not null default 0, cost bigint not null default 0, low_at numeric not null default 0
);

create table stock_moves (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, product_id uuid not null, qty numeric not null,
  reason text not null check (reason in ('opening', 'sale', 'restock', 'adjust', 'reversal')), ref_id uuid, date date not null
);

create table groups (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  name text not null, kind text not null check (kind in ('osusu', 'dues')), amount bigint not null check (amount > 0),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')), start_date date not null,
  members jsonb not null default '[]', payouts jsonb not null default '{}'
);

create table contributions (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  group_id uuid not null, member_id uuid not null, round int not null check (round > 0), amount bigint not null,
  date date not null, method text not null default 'cash', payment_ref text
);

create table invoices (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, number text not null, contact_id uuid, customer text not null, phone text not null default '',
  items jsonb not null default '[]', date date not null, due_date date, notes text not null default '',
  status text not null check (status in ('unpaid', 'paid', 'void')), paid_date date,
  public_token text not null unique check (length(public_token) >= 16), txn_id uuid, ledger_id uuid
);

-- Written only by Edge Functions (service role). Clients can read.
create table payment_requests (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  kind text not null check (kind in ('checkout', 'ussd', 'payout')), invoice_id uuid, group_id uuid, amount bigint not null,
  status text not null default 'pending', provider_ref text, url text, ussd_code text, phone text, note text not null default ''
);

-- Append-only activity log.
create table audit (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  member_name text not null default '', action text not null, entity text not null, entity_id uuid not null, summary text not null default '', at bigint not null
);

-- Server-only tables (no client access at all).
create table org_secrets (
  org_id uuid primary key references orgs(id), monime_space_id text, monime_token_enc text, webhook_secret text,
  updated_at timestamptz not null default now()
);
create table ai_usage (org_id uuid not null references orgs(id), day date not null, count int not null default 0, primary key (org_id, day));

-- Sync indexes: pull by (org_id, rev).
create index on branches (org_id, rev);
create index on members (org_id, rev);
create index on members (user_id);
create index on contacts (org_id, rev);
create index on ledger (org_id, rev);
create index on transactions (org_id, rev);
create index on products (org_id, rev);
create index on stock_moves (org_id, rev);
create index on groups (org_id, rev);
create index on contributions (org_id, rev);
create index on invoices (org_id, rev);
create index on payment_requests (org_id, rev);
create index on audit (org_id, rev);
create index on orgs (rev);

-- Every write gets a fresh revision. Updates older than the stored row are ignored (last writer wins),
-- and identity columns can never be changed by a client.
create or replace function kopor_before_write() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then return null; end if;
    new.id := old.id;
    new.org_id := old.org_id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.rev := nextval('kopor_rev');
  return new;
end $$;

-- Org-specific protection: owner and plan can only be changed by the server.
create or replace function kopor_orgs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.owner_user_id := old.owner_user_id;
    if coalesce(auth.role(), '') <> 'service_role' then new.plan := old.plan; end if;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    new.plan := 'free';
    new.owner_user_id := auth.uid();
  end if;
  return new;
end $$;
create trigger orgs_guard before insert or update on orgs for each row execute function kopor_orgs_guard();

do $$
declare t text;
begin
  foreach t in array array['orgs','branches','members','contacts','ledger','transactions','products','stock_moves','groups','contributions','invoices','payment_requests','audit'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function kopor_before_write()', t || '_write', t);
  end loop;
end $$;
