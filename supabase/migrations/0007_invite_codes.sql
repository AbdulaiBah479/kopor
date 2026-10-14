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
