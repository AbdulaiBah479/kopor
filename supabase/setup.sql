-- Kopor database setup: all migrations in order. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a new project.

-- ===== 0001_schema.sql =====
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


-- ===== 0002_security.sql =====
-- Row-level security. Mirrors src/db/permissions.ts:
--   viewer (0) reads · cashier (1) records · manager (2) edits/deletes, stock, groups · owner (3) team & settings.
-- Records are never hard-deleted by clients (soft delete via `deleted`), so there are no DELETE policies.

-- Caller's role level in an org: -1 = not a member. The org creator always counts as owner.
create or replace function kopor_level(o uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce((select max(case role when 'owner' then 3 when 'manager' then 2 when 'cashier' then 1 else 0 end)
              from members where org_id = o and user_id = auth.uid() and active = 1 and deleted = 0), -1),
    case when exists (select 1 from orgs where id = o and owner_user_id = auth.uid()) then 3 else -1 end)
$$;

-- The caller's member id in an org (used to let cashiers update rows they created themselves).
create or replace function kopor_member_ids(o uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from members where org_id = o and user_id = auth.uid() and deleted = 0
$$;

alter table orgs enable row level security;
create policy orgs_select on orgs for select using (kopor_level(id) >= 0 or owner_user_id = auth.uid());
create policy orgs_insert on orgs for insert with check (auth.uid() is not null and owner_user_id = auth.uid());
create policy orgs_update on orgs for update using (kopor_level(id) >= 3) with check (kopor_level(id) >= 3);

-- Generic policies: (table, min level to insert, min level to update any row).
do $$
declare r record;
begin
  for r in select * from (values
      ('branches', 3, 3), ('members', 3, 3), ('contacts', 1, 1), ('ledger', 1, 2), ('transactions', 1, 2),
      ('products', 2, 2), ('stock_moves', 1, 2), ('groups', 2, 2), ('contributions', 1, 1), ('invoices', 1, 1), ('audit', 1, 99)
    ) as x(tbl, ins, upd) loop
    execute format('alter table %I enable row level security', r.tbl);
    execute format('create policy %I on %I for select using (kopor_level(org_id) >= 0)', r.tbl || '_select', r.tbl);
    execute format('create policy %I on %I for insert with check (kopor_level(org_id) >= %s)', r.tbl || '_insert', r.tbl, r.ins);
    -- Cashiers may re-save rows they created (needed for retrying a sync), but not other people's rows.
    execute format('create policy %I on %I for update using (kopor_level(org_id) >= %s or (kopor_level(org_id) >= %s and created_by in (select kopor_member_ids(org_id)))) with check (kopor_level(org_id) >= %s)',
      r.tbl || '_update', r.tbl, r.upd, least(r.ins, r.upd), least(r.ins, r.upd));
  end loop;
end $$;

-- Cashiers cannot delete money/stock records, even their own.
create or replace function kopor_no_cashier_delete() returns trigger language plpgsql as $$
begin
  if new.deleted = 1 and old.deleted = 0 and coalesce(auth.role(), '') <> 'service_role' and kopor_level(new.org_id) < 2 then
    raise exception 'Only managers and owners can delete records';
  end if;
  return new;
end $$;
create trigger ledger_no_delete before update on ledger for each row execute function kopor_no_cashier_delete();
create trigger transactions_no_delete before update on transactions for each row execute function kopor_no_cashier_delete();
create trigger stock_moves_no_delete before update on stock_moves for each row execute function kopor_no_cashier_delete();

-- Nobody but an owner can grant roles; no one can make themselves owner.
create or replace function kopor_members_guard() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or current_setting('kopor.claiming', true) = '1' then return new; end if;
  if kopor_level(new.org_id) < 3 then raise exception 'Only owners can manage staff'; end if;
  return new;
end $$;
create trigger members_guard before insert or update on members for each row execute function kopor_members_guard();

alter table payment_requests enable row level security;
create policy payment_requests_select on payment_requests for select using (kopor_level(org_id) >= 0);

alter table org_secrets enable row level security; -- no policies: service role only
alter table ai_usage enable row level security;    -- no policies: service role only

-- Staff invites: link member rows whose phone matches the signed-in account's phone.
-- The phone is taken from the account's auth email (p<digits>@phone.kopor.app), never from client input.
create or replace function kopor_norm_phone(p text, cc text) returns text language sql immutable as $$
  select case
    when d like '00%' then substr(d, 3)
    when d like cc || '%' and length(d) > 9 then d
    when d like '0%' then cc || substr(d, 2)
    else cc || d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function claim_invites() returns int
language plpgsql security definer set search_path = public as $$
declare v_phone text; n int;
begin
  if auth.uid() is null then return 0; end if;
  select substring(u.email from '^p(\d+)@phone\.kopor\.app$') into v_phone from auth.users u where u.id = auth.uid();
  if v_phone is null then return 0; end if;
  perform set_config('kopor.claiming', '1', true); -- lets members_guard accept this server-side link only
  update members m set user_id = auth.uid(), updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  from orgs o
  where m.org_id = o.id and m.user_id is null and m.active = 1 and m.deleted = 0 and m.phone <> ''
    and kopor_norm_phone(m.phone, o.country_code) = v_phone;
  get diagnostics n = row_count;
  perform set_config('kopor.claiming', '0', true);
  return n;
end $$;

-- Public invoice page: returns one invoice for its secret token (unguessable, ≥16 chars).
create or replace function public_invoice(token text)
returns table (number text, customer text, date date, due_date date, status text, items jsonb, notes text,
               org_name text, org_phone text, org_address text, momo_number text, currency text, pay_url text)
language sql stable security definer set search_path = public as $$
  select i.number, i.customer, i.date, i.due_date, i.status, i.items, i.notes,
         o.name, o.phone, o.address, o.momo_number, o.currency,
         (select p.url from payment_requests p where p.invoice_id = i.id and p.kind = 'checkout' and p.status = 'pending' order by p.created_at desc limit 1)
  from invoices i join orgs o on o.id = i.org_id
  where length(token) >= 16 and i.public_token = token and i.deleted = 0 and o.deleted = 0
$$;

revoke all on function public_invoice(text) from public;
grant execute on function public_invoice(text) to anon, authenticated;
revoke all on function claim_invites() from public;
grant execute on function claim_invites() to authenticated;


-- ===== 0003_features.sql =====
-- v2.1: tax & discounts, returns, end-of-day closings, Pro plan limits, account deletion.

-- Tax settings and server-controlled plan expiry on the business.
alter table orgs
  add column plan_until bigint,
  add column tax_rate numeric not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  add column tax_inclusive smallint not null default 1,
  add column tax_id text not null default '',
  add column receipt_footer text not null default '';

create or replace function kopor_orgs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(auth.role(), '') <> 'service_role' then
      new.owner_user_id := old.owner_user_id; new.plan := old.plan; new.plan_until := old.plan_until;
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    new.plan := 'free';
    new.plan_until := null;
    new.owner_user_id := auth.uid();
  end if;
  return new;
end $$;

-- Discounts, tax and refunds on sales; totals on invoices.
alter table transactions
  add column discount bigint not null default 0 check (discount >= 0),
  add column tax bigint not null default 0 check (tax >= 0),
  add column refund_of uuid;
alter table invoices
  add column discount bigint not null default 0 check (discount >= 0),
  add column tax bigint not null default 0 check (tax >= 0),
  add column total bigint;

alter table stock_moves drop constraint stock_moves_reason_check;
alter table stock_moves add constraint stock_moves_reason_check check (reason in ('opening', 'sale', 'restock', 'adjust', 'reversal', 'return'));

-- Only managers and owners may record refunds (a common fraud route).
create or replace function kopor_refund_guard() returns trigger language plpgsql as $$
begin
  if new.category = 'refund' and coalesce(auth.role(), '') <> 'service_role' and kopor_level(new.org_id) < 2 then
    raise exception 'Only managers and owners can record refunds';
  end if;
  return new;
end $$;
create trigger transactions_refund_guard before insert on transactions for each row execute function kopor_refund_guard();

-- End-of-day cash closings.
create table closings (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  branch_id uuid, date date not null, opening_float bigint not null default 0, expected bigint not null,
  counted bigint not null check (counted >= 0), difference bigint not null, note text not null default ''
);
create index on closings (org_id, rev);
create trigger closings_write before insert or update on closings for each row execute function kopor_before_write();
alter table closings enable row level security;
create policy closings_select on closings for select using (kopor_level(org_id) >= 0);
create policy closings_insert on closings for insert with check (kopor_level(org_id) >= 1);
create policy closings_update on closings for update
  using (kopor_level(org_id) >= 2 or (kopor_level(org_id) >= 1 and created_by in (select kopor_member_ids(org_id))))
  with check (kopor_level(org_id) >= 1);

-- Free plan limits: 1 branch, 3 active staff. Pro (paid, not expired) is unlimited.
create or replace function kopor_is_pro(o uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from orgs where id = o and plan = 'pro' and coalesce(plan_until, 0) > (extract(epoch from now()) * 1000)::bigint)
$$;

create or replace function kopor_plan_limits() returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') = 'service_role' or kopor_is_pro(new.org_id) then return new; end if;
  if tg_table_name = 'members' then
    if new.active = 1 and new.deleted = 0 and (tg_op = 'INSERT' or old.active = 0 or old.deleted = 1) then
      select count(*) into n from members where org_id = new.org_id and active = 1 and deleted = 0 and id <> new.id;
      if n >= 3 then raise exception 'Free plan allows 3 staff. Upgrade to Kopor Pro.'; end if;
    end if;
  elsif tg_op = 'INSERT' and new.deleted = 0 then
    select count(*) into n from branches where org_id = new.org_id and deleted = 0 and id <> new.id;
    if n >= 1 then raise exception 'Free plan allows 1 branch. Upgrade to Kopor Pro.'; end if;
  end if;
  return new;
end $$;
create trigger members_plan_limits before insert or update on members for each row execute function kopor_plan_limits();
create trigger branches_plan_limits before insert on branches for each row execute function kopor_plan_limits();

-- Public invoice: now returns the real total (after discount, with tax).
drop function if exists public_invoice(text);
create function public_invoice(token text)
returns table (number text, customer text, date date, due_date date, status text, items jsonb, notes text, discount bigint, tax bigint, total bigint,
               org_name text, org_phone text, org_address text, momo_number text, currency text, tax_id text, pay_url text)
language sql stable security definer set search_path = public as $$
  select i.number, i.customer, i.date, i.due_date, i.status, i.items, i.notes, i.discount, i.tax,
         coalesce(i.total, (select coalesce(sum((x->>'qty')::numeric * (x->>'price')::numeric), 0)::bigint from jsonb_array_elements(i.items) x)),
         o.name, o.phone, o.address, o.momo_number, o.currency, o.tax_id,
         (select p.url from payment_requests p where p.invoice_id = i.id and p.kind = 'checkout' and p.status = 'pending' order by p.created_at desc limit 1)
  from invoices i join orgs o on o.id = i.org_id
  where length(token) >= 16 and i.public_token = token and i.deleted = 0 and o.deleted = 0
$$;
revoke all on function public_invoice(text) from public;
grant execute on function public_invoice(text) to anon, authenticated;

-- Account deletion (Google Play requirement). Called only by the delete-account Edge Function (service role):
-- removes the user from every business, and closes businesses where they were the only owner.
create or replace function kopor_forget_user(uid uuid) returns void language plpgsql security definer set search_path = public as $$
declare now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  update orgs o set deleted = 1, updated_at = now_ms
  where o.deleted = 0 and exists (select 1 from members m where m.org_id = o.id and m.user_id = uid and m.role = 'owner' and m.active = 1)
    and not exists (select 1 from members m where m.org_id = o.id and m.user_id is distinct from uid and m.role = 'owner' and m.active = 1 and m.deleted = 0);
  update members set user_id = null, active = 0, updated_at = now_ms where user_id = uid;
  update orgs set owner_user_id = null where owner_user_id = uid;
end $$;
revoke all on function kopor_forget_user(uuid) from public, anon, authenticated;


-- ===== 0004_undo.sql =====
-- v3: anyone may undo (soft-delete) their OWN money/stock record within 10 minutes of creating it.
-- Older records, and other people's records, still need a manager or owner.
create or replace function kopor_no_cashier_delete() returns trigger language plpgsql as $$
declare now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if new.deleted = 1 and old.deleted = 0 and coalesce(auth.role(), '') <> 'service_role' and kopor_level(new.org_id) < 2 then
    if old.created_by in (select kopor_member_ids(old.org_id)) and now_ms - old.created_at < 600000 then
      return new;
    end if;
    raise exception 'Only managers and owners can delete records';
  end if;
  return new;
end $$;

-- ===== 0005_recovery.sql =====
-- Kopor 0005: PIN recovery codes (no paid SMS needed).
-- A one-time code is shown to the user once; only a salted SHA-256 hash is stored. Only the Edge Function
-- (service role) can read or write this table: RLS is on and there are no policies for app users.

create table if not exists recovery_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  salt text not null,
  attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table recovery_codes enable row level security;
revoke all on recovery_codes from anon, authenticated;

-- Look up an account by its sign-in address (server only).
create or replace function kopor_user_by_email(e text) returns uuid
language sql security definer set search_path = '' stable as $$
  select id from auth.users where email = lower(e) limit 1
$$;
revoke all on function kopor_user_by_email(text) from public, anon, authenticated;
grant execute on function kopor_user_by_email(text) to service_role;

-- ===== 0006_ai_anon.sql =====
-- Kopor 0006: AI for everyone. People who have not created a cloud account yet (demo, offline-first users) may use
-- AI and voice a few times a day. Usage is counted per hashed network address per day; the address itself is never stored.
-- Only the Edge Function (service role) can read or write this table.

create table if not exists ai_usage_anon (
  key text not null,
  day date not null,
  count int not null default 0,
  primary key (key, day)
);
alter table ai_usage_anon enable row level security;
revoke all on ai_usage_anon from anon, authenticated;

-- Old rows are useless after a day; keep the table small.
create or replace function kopor_ai_anon_cleanup() returns void language sql security definer set search_path = '' as $$
  delete from public.ai_usage_anon where day < current_date - 2
$$;
revoke all on function kopor_ai_anon_cleanup() from public, anon, authenticated;
grant execute on function kopor_ai_anon_cleanup() to service_role;

-- ===== 0007_invite_codes.sql =====
-- Kopor 0007: staff join a business with a one-time invite code.
-- Before: anyone who created an account with a staff member's (unverified) phone number joined that business
-- automatically. Now joining needs BOTH the matching phone number AND a code the owner sends to that person.
-- Codes are created and checked only on the server; only a SHA-256 hash is stored, and they expire after 7 days.

create table if not exists member_invites (
  member_id uuid primary key references members(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null
);
alter table member_invites enable row level security; -- no policies: reached only through the functions below
revoke all on member_invites from anon, authenticated;

-- Automatic claiming by phone number alone is switched off (kept so older app versions do not error).
create or replace function claim_invites() returns int language sql stable as $$ select 0 $$;

create or replace function kopor_invite_hash(code text) returns text language sql immutable as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

-- Owner creates (or replaces) the invite for one staff member and receives the code once.
create or replace function create_member_invite(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  select org_id into v_org from members where id = p_member and user_id is null and active = 1 and deleted = 0 and phone <> '';
  if v_org is null then raise exception 'errx.inviteMember'; end if;
  if kopor_level(v_org) < 3 then raise exception 'errx.inviteRole'; end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into member_invites (member_id, org_id, code_hash, expires_at)
    values (p_member, v_org, kopor_invite_hash(v_code), now() + interval '7 days')
    on conflict (member_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end $$;

-- Staff member (signed in with the invited phone number) enters the code to join.
create or replace function claim_invite(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_phone text; v_member uuid; v_org uuid;
begin
  if auth.uid() is null then raise exception 'errx.inviteSignIn'; end if;
  select substring(u.email from '^p(\d+)@phone\.kopor\.app$') into v_phone from auth.users u where u.id = auth.uid();
  select i.member_id, i.org_id into v_member, v_org
    from member_invites i join members m on m.id = i.member_id join orgs o on o.id = m.org_id
    where i.code_hash = kopor_invite_hash(code) and i.expires_at > now()
      and m.user_id is null and m.active = 1 and m.deleted = 0
      and v_phone is not null and kopor_norm_phone(m.phone, o.country_code) = v_phone;
  if v_member is null then raise exception 'errx.inviteBad'; end if;
  perform set_config('kopor.claiming', '1', true); -- lets members_guard accept this server-side link only
  update members set user_id = auth.uid(), updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint where id = v_member;
  perform set_config('kopor.claiming', '0', true);
  delete from member_invites where member_id = v_member;
  return v_org;
end $$;

revoke all on function create_member_invite(uuid) from public, anon;
revoke all on function claim_invite(text) from public, anon;
grant execute on function create_member_invite(uuid) to authenticated;
grant execute on function claim_invite(text) to authenticated;
revoke all on function claim_invites() from public, anon;
grant execute on function claim_invites() to authenticated;

-- ===== 0008_hardening.sql =====
-- Kopor 0008: hardening from the Supabase security advisor.
-- 1) Fixed search_path on every Kopor function, so none can be tricked into using a look-alike object.
-- 2) Helper functions used by row-level security are not callable by signed-out (anon) users.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'kopor\_%' or p.proname in ('claim_invites', 'claim_invite', 'create_member_invite', 'public_invoice'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['kopor_is_pro(uuid)', 'kopor_level(uuid)', 'kopor_member_ids(uuid)', 'kopor_plan_limits()'] loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon', fn);
      execute format('grant execute on function public.%s to authenticated, service_role', fn);
    end if;
  end loop;
end $$;
