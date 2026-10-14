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
