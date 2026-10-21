-- Kopor 0015: members record their own payments from the group's member link ("I've paid"), without an account.
-- A claim is only a note to the treasurer: nothing counts until the treasurer approves it in Kopor, so a wrong or
-- false claim can never change anyone's balance.

create table if not exists group_claims (
  id uuid primary key, org_id uuid not null references orgs(id), created_at bigint not null, updated_at bigint not null,
  deleted smallint not null default 0, created_by uuid, rev bigint not null default 0,
  group_id uuid not null, member_id uuid not null, kind text not null check (kind in ('contribution', 'repay')),
  round int check (round is null or round > 0), amount bigint not null check (amount > 0 and amount <= 100000000),
  method text not null default 'cash' check (method in ('cash', 'orange', 'afrimoney', 'qmoney', 'bank')),
  ref text not null default '' check (length(ref) <= 60), note text not null default '' check (length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);
create index if not exists group_claims_rev on group_claims (org_id, rev);

drop trigger if exists group_claims_write on group_claims;
create trigger group_claims_write before insert or update on group_claims for each row execute function kopor_before_write();
alter table group_claims enable row level security;
drop policy if exists group_claims_select on group_claims;
create policy group_claims_select on group_claims for select using (kopor_level(org_id) >= 0);
-- Business staff may also insert (e.g. a claim recorded on a member's behalf); members use submit_group_claim below.
drop policy if exists group_claims_insert on group_claims;
create policy group_claims_insert on group_claims for insert with check (kopor_level(org_id) >= 1);
-- Approving or rejecting: anyone who can record payments.
drop policy if exists group_claims_update on group_claims;
create policy group_claims_update on group_claims for update using (kopor_level(org_id) >= 1) with check (kopor_level(org_id) >= 1);

-- Called from the member link (signed out). Checks the secret group token, that the member is on the group's list,
-- and limits how many claims can wait at once (stops anyone flooding a group with fake claims).
create or replace function submit_group_claim(token text, member text, kind text, amount bigint, round int, method text, ref text, note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g groups%rowtype; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if length(coalesce(token, '')) < 16 then raise exception 'invalid link'; end if;
  select * into g from groups where public_token = token and deleted = 0;
  if not found then raise exception 'invalid link'; end if;
  if not exists (select 1 from jsonb_array_elements(g.members) m where m->>'id' = member) then raise exception 'not a member'; end if;
  if kind not in ('contribution', 'repay') then raise exception 'invalid claim'; end if;
  if (select count(*) from group_claims c where c.group_id = g.id and c.status = 'pending' and c.deleted = 0) >= 100
     or (select count(*) from group_claims c where c.group_id = g.id and c.member_id::text = member and c.status = 'pending' and c.deleted = 0) >= 5 then
    raise exception 'too many claims waiting';
  end if;
  insert into group_claims (id, org_id, created_at, updated_at, created_by, group_id, member_id, kind, round, amount, method, ref, note)
  values (gen_random_uuid(), g.org_id, now_ms, now_ms, null, g.id, member::uuid, kind, case when kind = 'contribution' then round end,
          amount, coalesce(nullif(method, ''), 'cash'), left(coalesce(ref, ''), 60), left(coalesce(note, ''), 200));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function submit_group_claim(text, text, text, bigint, int, text, text, text) from public;
grant execute on function submit_group_claim(text, text, text, bigint, int, text, text, text) to anon, authenticated;
