-- Kopor 0036: protections copied from banking practice (two-person approval, tamper-proof history, phones list,
-- safer payouts). Every rule is enforced here on the server, not only in the app.

------------------------------------------------------------------------------------------------------------------
-- 1. Two-person approval ("maker-checker"): some actions by staff need the owner. The staff member's phone sends a
--    request; the owner approves it on their own phone, which then does the action as the owner.
--      refund   a refund above the owner's approval amount (orgs.approve_over, default Le 1,000; 0 = off)
--      delete   a manager deleting a sale or credit entry older than 24 hours
--      credit   credit (or a sale on credit) above the customer's credit limit
------------------------------------------------------------------------------------------------------------------
alter table orgs add column if not exists approve_over bigint check (approve_over is null or approve_over >= 0);

create table if not exists approvals (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('refund', 'delete', 'credit', 'sale')),
  payload jsonb not null check (pg_column_size(payload) < 8000),
  amount bigint not null default 0,
  summary text not null default '' check (length(summary) <= 300),
  requested_by uuid not null, requested_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  decided_at timestamptz, at timestamptz not null default now()
);
create index if not exists approvals_org_pending on approvals (org_id, at desc) where status = 'pending';
alter table approvals enable row level security;
drop policy if exists approvals_select on approvals;
create policy approvals_select on approvals for select
  using (kopor_level(org_id) >= 3 or requested_by in (select kopor_member_ids(org_id)));
revoke insert, update, delete on approvals from anon, authenticated;
grant select on approvals to authenticated;

create or replace function kopor_request_approval(o uuid, k text, p jsonb, amt bigint, s text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; nid bigint;
begin
  select id, name into m from members where org_id = o and user_id = auth.uid() and active = 1 and deleted = 0 limit 1;
  if m.id is null then raise exception 'errx.role'; end if;
  if (select count(*) from approvals where org_id = o and requested_by = m.id and at > now() - interval '1 day') >= 30 then
    raise exception 'errx.tooManyRequests';
  end if;
  insert into approvals (org_id, kind, payload, amount, summary, requested_by, requested_name)
    values (o, k, p, coalesce(amt, 0), left(coalesce(s, ''), 300), m.id, m.name) returning id into nid;
  perform kopor_alert(o, 'approval', nid::text, m.name, coalesce(amt, 0), left(coalesce(s, ''), 200));
  return nid;
end $$;
revoke all on function kopor_request_approval(uuid, text, jsonb, bigint, text) from public, anon;
grant execute on function kopor_request_approval(uuid, text, jsonb, bigint, text) to authenticated;

-- The owner marks a request done (after doing it on their phone) or rejected.
create or replace function kopor_decide_approval(aid bigint, done boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o uuid;
begin
  select org_id into o from approvals where id = aid and status = 'pending';
  if o is null then raise exception 'err.notFound'; end if;
  if kopor_level(o) < 3 then raise exception 'errx.role'; end if;
  update approvals set status = case when done then 'done' else 'rejected' end, decided_at = now() where id = aid;
end $$;
revoke all on function kopor_decide_approval(bigint, boolean) from public, anon;
grant execute on function kopor_decide_approval(bigint, boolean) to authenticated;

-- Server rules behind the approvals: big refunds and old deletions only by the owner.
create or replace function kopor_need_owner() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare lim bigint; lvl int;
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  lvl := kopor_level(new.org_id);
  if lvl >= 3 or lvl < 0 then return new; end if;
  -- (Nested ifs: a credit entry has no "category", so the table is checked before that field is read.)
  if tg_table_name = 'transactions' and tg_op = 'INSERT' then
    if new.category = 'refund' and new.deleted = 0 then
      select coalesce(approve_over, 100000) into lim from orgs where id = new.org_id;
      if lim > 0 and new.amount > lim then raise exception 'err.needsApproval' using errcode = 'P0001'; end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.deleted = 0 and new.deleted = 1 and old.created_at < (extract(epoch from now()) * 1000)::bigint - 86400000 then
    raise exception 'err.needsApproval' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['transactions', 'ledger'] loop
    execute format('drop trigger if exists %I on %I', t || '_need_owner', t);
    execute format('create trigger %I before insert or update on %I for each row execute function kopor_need_owner()', t || '_need_owner', t);
  end loop;
end $$;

------------------------------------------------------------------------------------------------------------------
-- 2. Tamper-proof history: each history entry carries a fingerprint (SHA-256) of itself and of the entry before
--    it, so deleting or changing any past entry breaks the chain, and the owner sees it. History entries can no
--    longer be changed or deleted by anyone but the server.
------------------------------------------------------------------------------------------------------------------
alter table audit add column if not exists seq bigint generated always as identity;
alter table audit add column if not exists prev_hash text;
alter table audit add column if not exists hash text;
create index if not exists audit_org_seq on audit (org_id, seq);

create or replace function kopor_audit_fingerprint(a audit, prev text) returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|', coalesce(prev, ''), a.id, a.org_id, a.created_by, a.member_name, a.action, a.entity,
    a.entity_id, a.summary, a.at), 'UTF8')), 'hex')
$$;

create or replace function kopor_audit_chain() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare prev text;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext(new.org_id::text));
    select hash into prev from audit where org_id = new.org_id and hash is not null order by seq desc limit 1;
    new.prev_hash := prev;
    new.hash := kopor_audit_fingerprint(new, prev);
    return new;
  end if;
  -- A phone sending the same entry again (sync retry) is fine; changing what it says is not.
  if coalesce(auth.role(), '') <> 'service_role' and (new.member_name, new.action, new.entity, new.entity_id, new.summary, new.at, new.created_by, new.deleted)
     is distinct from (old.member_name, old.action, old.entity, old.entity_id, old.summary, old.at, old.created_by, old.deleted) then
    raise exception 'errx.historyLocked';
  end if;
  new.prev_hash := old.prev_hash; new.hash := old.hash; new.seq := old.seq;
  return new;
end $$;
drop trigger if exists zz_audit_chain on audit;
create trigger zz_audit_chain before insert or update on audit for each row execute function kopor_audit_chain();

create or replace function kopor_audit_no_delete() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'errx.historyLocked'; end if;
  return old;
end $$;
drop trigger if exists audit_no_delete on audit;
create trigger audit_no_delete before delete on audit for each row execute function kopor_audit_no_delete();

-- Fingerprint the history that already exists, oldest first.
do $$
declare r audit; prev text; cur uuid;
begin
  for r in select * from audit where hash is null order by org_id, seq loop
    if cur is distinct from r.org_id then cur := r.org_id; prev := (select hash from audit where org_id = r.org_id and hash is not null order by seq desc limit 1); end if;
    update audit set prev_hash = prev, hash = kopor_audit_fingerprint(r, prev) where id = r.id;
    prev := kopor_audit_fingerprint(r, prev);
  end loop;
end $$;

-- The owner's history check: recompute every fingerprint in order; report the first entry that does not match.
create or replace function kopor_verify_audit(o uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r audit; prev text; n int := 0;
begin
  if kopor_level(o) < 3 then raise exception 'errx.role'; end if;
  for r in select * from audit where org_id = o order by seq loop
    n := n + 1;
    if r.prev_hash is distinct from prev or r.hash is distinct from kopor_audit_fingerprint(r, prev) then
      return jsonb_build_object('ok', false, 'checked', n, 'broken_at', r.at, 'summary', r.summary);
    end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'checked', n);
end $$;
revoke all on function kopor_verify_audit(uuid) from public, anon;
grant execute on function kopor_verify_audit(uuid) to authenticated;

------------------------------------------------------------------------------------------------------------------
-- 3. Phones list: every phone signed in to the business, when it was last seen, and a way to sign one out.
--    A new phone alerts the owner.
------------------------------------------------------------------------------------------------------------------
create table if not exists devices (
  org_id uuid not null references orgs(id), device_id text not null check (length(device_id) between 16 and 64),
  user_id uuid not null, member_name text not null default '', label text not null default '' check (length(label) <= 80),
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), revoked boolean not null default false,
  primary key (org_id, device_id)
);
alter table devices enable row level security;
drop policy if exists devices_select on devices;
create policy devices_select on devices for select using (kopor_level(org_id) >= 3 or user_id = auth.uid());
revoke insert, update, delete on devices from anon, authenticated;
grant select on devices to authenticated;

-- A phone says it is here. Returns 'ok', or 'revoked' when the owner signed this phone out.
create or replace function kopor_device_seen(o uuid, d text, l text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; row devices; others int;
begin
  select id, name, role into m from members where org_id = o and user_id = auth.uid() and active = 1 and deleted = 0 limit 1;
  if m.id is null then raise exception 'errx.role'; end if;
  select * into row from devices where org_id = o and device_id = d;
  if found then
    if row.user_id <> auth.uid() then raise exception 'errx.role'; end if;
    if row.revoked then return 'revoked'; end if;
    update devices set last_seen = now(), label = left(coalesce(l, ''), 80), member_name = m.name where org_id = o and device_id = d;
    return 'ok';
  end if;
  select count(*) into others from devices where org_id = o and user_id = auth.uid();
  insert into devices (org_id, device_id, user_id, member_name, label) values (o, d, auth.uid(), m.name, left(coalesce(l, ''), 80));
  -- The owner is told about every new phone, except their own very first one.
  if others > 0 or m.role <> 'owner' then
    perform kopor_alert(o, 'newDevice', d, m.name, 0, left(coalesce(l, ''), 80));
  end if;
  return 'ok';
end $$;
revoke all on function kopor_device_seen(uuid, text, text) from public, anon;
grant execute on function kopor_device_seen(uuid, text, text) to authenticated;

-- The owner signs a phone out (or anyone signs out their own phone).
create or replace function kopor_device_revoke(o uuid, d text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (kopor_level(o) >= 3 or exists (select 1 from devices where org_id = o and device_id = d and user_id = auth.uid())) then
    raise exception 'errx.role';
  end if;
  update devices set revoked = true where org_id = o and device_id = d;
end $$;
revoke all on function kopor_device_revoke(uuid, text) from public, anon;
grant execute on function kopor_device_revoke(uuid, text) to authenticated;

------------------------------------------------------------------------------------------------------------------
-- 4. Safer payouts: a daily limit (orgs.payout_daily_max, default Le 20,000) and a 24-hour wait before the first
--    payout to a new number. Checked by the monime server function before any money moves.
------------------------------------------------------------------------------------------------------------------
alter table orgs add column if not exists payout_daily_max bigint check (payout_daily_max is null or payout_daily_max > 0);
create table if not exists payout_payees (
  org_id uuid not null references orgs(id), phone text not null, added_at timestamptz not null default now(),
  primary key (org_id, phone)
);
alter table payout_payees enable row level security;
revoke all on payout_payees from anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- New alert kinds: an approval request, and a new phone signing in.
------------------------------------------------------------------------------------------------------------------
alter table alerts drop constraint if exists alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('short', 'deleted', 'away', 'left', 'fake', 'refund', 'approval', 'newDevice'));
