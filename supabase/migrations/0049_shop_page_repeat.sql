-- Kopor 0049: repeat invoices, the shop page, and owner text commands.
--
-- 1) Repeat invoices: an invoice can repeat every month (rent, school fees, a monthly supply contract). A manager's
--    phone creates each month's invoice through the normal invoice code (src/domain/repeat.ts), after claiming it here,
--    so two phones can never create the same month twice and charge the customer twice.
alter table invoices add column if not exists repeat_every text check (repeat_every is null or repeat_every = 'month');
alter table invoices add column if not exists repeat_next date;

create table if not exists repeat_claims (template_id uuid not null, period date not null, org_id uuid not null, at timestamptz not null default now(), primary key (template_id, period));
alter table repeat_claims enable row level security;
revoke all on repeat_claims from anon, authenticated;

create or replace function kopor_claim_repeat(o uuid, t uuid, p date) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if kopor_level(o) < 2 then raise exception 'errx.role'; end if;
  if not exists (select 1 from invoices where id = t and org_id = o) then raise exception 'err.notFound'; end if;
  insert into repeat_claims (template_id, period, org_id) values (t, p, o) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function kopor_claim_repeat(uuid, uuid, date) from public, anon;
grant execute on function kopor_claim_repeat(uuid, uuid, date) to authenticated;

-- 2) Shop page: the public price list also shows opening hours, the working days, a map link and, when the shop has a
--    pay-QR poster, a "Pay now" button (the same secret as the poster).
create or replace function public_catalog(token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', o.name, 'phone', o.phone, 'address', coalesce(o.address, ''), 'momo', coalesce(o.momo_number, ''), 'currency', o.currency,
    'open_at', o.open_at, 'close_at', o.close_at, 'work_days', o.work_days,
    'lat', o.shop_lat, 'lng', o.shop_lng, 'pay_token', o.pay_token,
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'unit', p.unit, 'price', p.price,
        'pack_name', p.pack_name, 'pack_size', p.pack_size, 'pack_price', p.pack_price,
        'in_stock', coalesce((select sum(m.qty) from stock_moves m where m.product_id = p.id and m.deleted = 0), 0) > 0) order by p.name)
      from products p where p.org_id = o.id and p.deleted = 0 and p.price > 0), '[]'::jsonb)
  )
  from orgs o where length(token) >= 24 and o.catalog_token = token and o.deleted = 0
$$;
revoke all on function public_catalog(text) from public;
grant execute on function public_catalog(text) to anon, authenticated;

-- 3) Owner text commands (TODAY, OWE, STOCK with the owner's PIN) count towards the daily text limit.
alter table sms_log drop constraint if exists sms_log_kind_check;
alter table sms_log add constraint sms_log_kind_check check (kind in ('reminder', 'balance', 'test', 'alert', 'weekly', 'broadcast', 'receipt', 'dueSoon', 'command'));
