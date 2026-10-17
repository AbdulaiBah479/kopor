-- Kopor 0012: quotations and customer statement links.

-- 1) Quotations live with invoices. A quotation records nothing (no sale, stock or debt) until it is accepted,
--    when the app turns it into a normal invoice and marks the quotation 'accepted'.
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check check (status in ('unpaid', 'paid', 'void', 'quote', 'accepted'));

-- 2) Statement links: a secret token per customer, created the first time the business shares a statement.
--    Making a new token stops the old link working.
alter table contacts add column if not exists public_token text unique check (public_token is null or length(public_token) >= 16);

-- What a customer sees from their link: the business, their own name, balance and entries. Never their phone number,
-- other customers, or anything else in the book.
create or replace function public_statement(token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', c.name,
    'org_name', o.name, 'org_phone', o.phone, 'org_address', o.address, 'momo_number', o.momo_number, 'currency', o.currency,
    'balance', coalesce((select sum(case when l.type = 'gave' then l.amount else -l.amount end) from ledger l
                         where l.contact_id = c.id and l.org_id = c.org_id and l.deleted = 0), 0),
    'entries', coalesce((select jsonb_agg(e order by e.date desc, e.created_at desc) from (
                  select l.date, l.type, l.amount, l.note, l.due_date, l.created_at from ledger l
                  where l.contact_id = c.id and l.org_id = c.org_id and l.deleted = 0
                  order by l.date desc, l.created_at desc limit 200) e), '[]'::jsonb))
  from contacts c join orgs o on o.id = c.org_id
  where length(token) >= 16 and c.public_token = token and c.deleted = 0 and o.deleted = 0
$$;
revoke all on function public_statement(text) from public;
grant execute on function public_statement(text) to anon, authenticated;
