-- Kopor 0052: receipts anyone can check, and "invite a shop, get a free month of Pro".

------------------------------------------------------------------------------------------------------------------
-- 1. Receipt check: every sale receipt carries a 12-character code (the start of the sale's id, which nobody can
--    guess: 2^48 possibilities). Anyone with the code sees which shop, how much, when, and whether the sale still
--    stands, so a faked or edited receipt screenshot is caught.
------------------------------------------------------------------------------------------------------------------
create index if not exists transactions_receipt_code on transactions ((left(replace(id::text, '-', ''), 12)));

create or replace function public_receipt(code text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select lower(regexp_replace(coalesce(code, ''), '[^0-9a-fA-F]', '', 'g')) as k)
  select jsonb_build_object(
    'shop', o.name, 'shop_phone', o.phone, 'currency', o.currency,
    'amount', t.amount, 'date', t.date, 'method', t.method,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i->>'name', 'qty', i->'qty')) from (select i from jsonb_array_elements(t.items) i limit 30) x), '[]'::jsonb),
    'status', case when t.deleted = 1 then 'cancelled'
                   when exists (select 1 from transactions r where r.org_id = t.org_id and r.refund_of = t.id and r.deleted = 0) then 'refunded'
                   else 'ok' end,
    'confirmed', t.verified_ref is not null)
  from c, transactions t join orgs o on o.id = t.org_id
  where length(c.k) = 12 and left(replace(t.id::text, '-', ''), 12) = c.k and t.type = 'in' and o.deleted = 0
  limit 1
$$;
revoke all on function public_receipt(text) from public;
grant execute on function public_receipt(text) to anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- 2. Referrals. Each business gets a short invite code; a new business can name who invited it (once, in its
--    first 30 days). When the invited business has really used Kopor on 7 different days, the inviter gets 30
--    days of Pro. Only the billing server function sets these (clients cannot change them).
------------------------------------------------------------------------------------------------------------------
alter table orgs add column if not exists ref_code text unique;
alter table orgs add column if not exists referred_by uuid references orgs(id);

create table if not exists referral_rewards (
  invited_org uuid primary key references orgs(id),      -- one reward per invited business, ever
  inviter uuid not null references orgs(id),
  rewarded_at timestamptz not null default now()
);
alter table referral_rewards enable row level security;
revoke all on referral_rewards from anon, authenticated;

-- The plan, the owner, the trial date and the referral fields change only through the server.
create or replace function kopor_orgs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(auth.role(), '') <> 'service_role' then
      new.owner_user_id := old.owner_user_id; new.plan := old.plan; new.plan_until := old.plan_until; new.pro_trial_at := old.pro_trial_at;
      new.ref_code := old.ref_code; new.referred_by := old.referred_by;
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    new.plan := 'free';
    new.plan_until := null;
    new.pro_trial_at := null;
    new.owner_user_id := auth.uid();
    new.ref_code := null;
    new.referred_by := null;
  end if;
  return new;
end $$;

-- Days on which an invited business recorded anything (sales, expenses or credit): the "really used" test.
create or replace function kopor_active_days(target uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(distinct d)::int from (
    select date as d from transactions where org_id = target and deleted = 0
    union select date from ledger where org_id = target and deleted = 0
  ) x
$$;
revoke all on function kopor_active_days(uuid) from public, anon, authenticated;
grant execute on function kopor_active_days(uuid) to service_role;
