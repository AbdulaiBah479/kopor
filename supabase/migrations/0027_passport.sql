-- Kopor 0027: Credit Passport. A business owner shares a link (or QR) that shows a lender the business's real
-- record: six months of sales, expenses and profit, how many days it kept records, how well its customers repay
-- credit, and how much money was confirmed by Monime. The figures are worked out HERE, by Kopor's server, from the
-- records it holds (never typed in by the owner), and each passport is a frozen copy with an expiry date.

create table if not exists passports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  token text not null unique check (length(token) >= 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_by uuid,
  data jsonb not null
);
alter table passports enable row level security;
revoke all on passports from anon, authenticated;
grant select (id, org_id, token, created_at, expires_at, revoked) on passports to authenticated;
drop policy if exists passports_owner on passports;
create policy passports_owner on passports for select to authenticated using (kopor_level(org_id) >= 3);

-- The six-month record of one business (frozen into a passport).
create or replace function kopor_passport_data(oid uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with span as (select (date_trunc('month', current_date) - interval '5 months')::date as start),
  t as (select * from transactions, span where org_id = oid and deleted = 0 and date >= span.start),
  months as (
    select to_char(m, 'YYYY-MM') as month,
      coalesce(sum(case when t.type = 'in' then t.amount when t.category = 'refund' then -t.amount end), 0) as sales,
      coalesce(sum(case when t.type = 'out' and t.category <> 'refund' then t.amount end), 0) as expenses,
      count(distinct t.date) as days, count(t.id) as records
    from span, generate_series(span.start, date_trunc('month', current_date), interval '1 month') m
    left join t on date_trunc('month', t.date) = m
    group by m order by m
  ),
  cust as (select id from contacts where org_id = oid and deleted = 0 and kind = 'customer'),
  l as (select l.* from ledger l, span where l.org_id = oid and l.deleted = 0 and l.date >= span.start and l.contact_id in (select id from cust)),
  bal as (select contact_id, sum(case when type = 'gave' then amount else -amount end) as b from ledger
          where org_id = oid and deleted = 0 and contact_id in (select id from cust) group by contact_id)
  select jsonb_build_object(
    'business', (select jsonb_build_object('name', o.name, 'type', o.type, 'owner_name', o.owner_name, 'phone', o.phone, 'address', o.address) from orgs o where o.id = oid),
    'since', (select min(date) from transactions where org_id = oid and deleted = 0),
    'months', (select coalesce(jsonb_agg(to_jsonb(months)), '[]'::jsonb) from months),
    'sales_6m', (select coalesce(sum(sales), 0) from months),
    'expenses_6m', (select coalesce(sum(expenses), 0) from months),
    'active_days_6m', (select count(distinct date) from t),
    'records_6m', (select count(*) from t),
    'credit_given_6m', (select coalesce(sum(amount), 0) from l where type = 'gave'),
    'credit_repaid_6m', (select coalesce(sum(amount), 0) from l where type = 'got'),
    'customers_owe_now', (select coalesce(sum(b), 0) from bal where b > 0),
    'customers', (select count(*) from cust),
    'monime_confirmed_6m', (select coalesce(sum(amount), 0) from t where type = 'in' and verified_ref is not null),
    'staff', (select count(*) from members where org_id = oid and deleted = 0 and active = 1),
    'branches', (select count(*) from branches where org_id = oid and deleted = 0)
  )
$$;
revoke all on function kopor_passport_data(uuid) from public, anon, authenticated;

-- Owners only: freeze today's record into a new passport (valid 90 days) and get its secret link token.
create or replace function kopor_make_passport(oid uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if kopor_level(oid) < 3 then raise exception 'Only the owner can create a Credit Passport'; end if;
  if (select count(*) from passports where org_id = oid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many passports today. Try again tomorrow.';
  end if;
  insert into passports (org_id, token, expires_at, created_by, data)
  values (oid, tok, now() + interval '90 days', auth.uid(), kopor_passport_data(oid));
  return tok;
end $$;
revoke all on function kopor_make_passport(uuid) from public, anon;
grant execute on function kopor_make_passport(uuid) to authenticated;

-- Owners only: stop a shared passport from opening.
create or replace function kopor_revoke_passport(pid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update passports set revoked = true where id = pid and kopor_level(org_id) >= 3;
  if not found then raise exception 'Passport not found'; end if;
end $$;
revoke all on function kopor_revoke_passport(uuid) from public, anon;
grant execute on function kopor_revoke_passport(uuid) to authenticated;

-- What a lender sees from the link: the frozen record, when it was made and until when it is valid.
create or replace function public_passport(token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('data', p.data, 'created_at', p.created_at, 'expires_at', p.expires_at, 'id', p.id)
  from passports p where p.token = public_passport.token and length(public_passport.token) >= 32
    and not p.revoked and p.expires_at > now()
$$;
revoke all on function public_passport(text) from public;
grant execute on function public_passport(text) to anon, authenticated;
