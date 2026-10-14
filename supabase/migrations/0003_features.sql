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
