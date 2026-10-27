-- Kopor 0035: shift handover, public price list, loyalty, and a refund alert.
--
-- Shift handover: a cash count between two cashiers (closings.kind = 'handover', handed_to = who takes over). A
-- shortage is then the outgoing cashier's, and it makes a "short" alert like a day close does.
alter table closings add column if not exists kind text not null default 'close' check (kind in ('close', 'handover'));
alter table closings add column if not exists handed_to uuid;

-- Loyalty: every Nth visit day a customer gets pct % off (owner's setting; at most 20 %).
alter table orgs add column if not exists loyalty_every smallint check (loyalty_every is null or loyalty_every between 2 and 100);
alter table orgs add column if not exists loyalty_pct smallint check (loyalty_pct is null or loyalty_pct between 1 and 20);

-- Public price list: a secret link (and QR code) customers open to see the real prices, so nobody can overcharge them.
alter table orgs add column if not exists catalog_token text check (catalog_token is null or length(catalog_token) >= 24);
create unique index if not exists orgs_catalog_token on orgs (catalog_token) where catalog_token is not null;

-- Owners and managers make (or renew, which stops the old link) the price list link.
create or replace function kopor_catalog_token(o uuid, renew boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare tok text;
begin
  if kopor_level(o) < 2 then raise exception 'errx.role'; end if;
  select catalog_token into tok from orgs where id = o;
  if tok is null or renew then
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update orgs set catalog_token = tok where id = o;
  end if;
  return tok;
end $$;
revoke all on function kopor_catalog_token(uuid, boolean) from public, anon;
grant execute on function kopor_catalog_token(uuid, boolean) to authenticated;

-- What a customer sees: the business's name and contacts, and each product's name, unit, price, carton price and
-- whether it is in stock. Never costs, quantities, customers or anything else.
create or replace function public_catalog(token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', o.name, 'phone', o.phone, 'address', coalesce(o.address, ''), 'momo', coalesce(o.momo_number, ''), 'currency', o.currency,
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

-- An alert for every refund made by someone other than the owner (refunds are a common way to take cash).
alter table alerts drop constraint if exists alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('short', 'deleted', 'away', 'left', 'fake', 'refund'));
create or replace function kopor_alert_refund() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.type = 'out' and new.category = 'refund' and new.deleted = 0 and kopor_level(new.org_id) between 0 and 2 then
    perform kopor_alert(new.org_id, 'refund', new.id::text, kopor_member_name(new.created_by), new.amount,
      case when new.refund_of is null then 'no-sale' else '' end);
  end if;
  return new;
end $$;
drop trigger if exists transactions_refund_alert on transactions;
create trigger transactions_refund_alert after insert on transactions for each row execute function kopor_alert_refund();

-- Short alerts say whether it was a day close or a handover between cashiers.
create or replace function kopor_alert_closing() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare momo bigint := 0; k text; v jsonb;
begin
  for k, v in select * from jsonb_each(coalesce(new.momo, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'object' and (v->>'expected')::bigint > (v->>'counted')::bigint then
      momo := momo + (v->>'expected')::bigint - (v->>'counted')::bigint;
    end if;
  end loop;
  if new.deleted = 0 and (new.difference < 0 or momo > 0) then
    perform kopor_alert(new.org_id, 'short', new.id::text, kopor_member_name(new.created_by), greatest(0, -new.difference) + momo,
      new.date::text || case when momo > 0 then ' momo' else '' end || case when new.kind = 'handover' then ' handover' else '' end);
  end if;
  return new;
end $$;
