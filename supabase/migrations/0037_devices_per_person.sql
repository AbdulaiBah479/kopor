-- Kopor 0037: one shop phone is often shared by several staff, so the phones list keeps one row per person per
-- phone (it kept one row per phone, so a second person on the same phone was not recorded).
alter table devices drop constraint if exists devices_pkey;
alter table devices add primary key (org_id, device_id, user_id);

create or replace function kopor_device_seen(o uuid, d text, l text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; row devices; others int;
begin
  select id, name, role into m from members where org_id = o and user_id = auth.uid() and active = 1 and deleted = 0 limit 1;
  if m.id is null then raise exception 'errx.role'; end if;
  select * into row from devices where org_id = o and device_id = d and user_id = auth.uid();
  if found then
    if row.revoked then return 'revoked'; end if;
    update devices set last_seen = now(), label = left(coalesce(l, ''), 80), member_name = m.name where org_id = o and device_id = d and user_id = auth.uid();
    return 'ok';
  end if;
  select count(*) into others from devices where org_id = o and user_id = auth.uid();
  insert into devices (org_id, device_id, user_id, member_name, label) values (o, d, auth.uid(), m.name, left(coalesce(l, ''), 80));
  -- The owner is told about every new phone, except their own very first one.
  if others > 0 or m.role <> 'owner' then
    perform kopor_alert(o, 'newDevice', d || ':' || auth.uid()::text, m.name, 0, left(coalesce(l, ''), 80));
  end if;
  return 'ok';
end $$;

drop function if exists kopor_device_revoke(uuid, text);
-- The owner signs one person out on one phone (or anyone signs themselves out of their own phone).
create or replace function kopor_device_revoke(o uuid, d text, u uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (kopor_level(o) >= 3 or u = auth.uid()) then raise exception 'errx.role'; end if;
  update devices set revoked = true where org_id = o and device_id = d and user_id = u;
end $$;
revoke all on function kopor_device_revoke(uuid, text, uuid) from public, anon;
grant execute on function kopor_device_revoke(uuid, text, uuid) to authenticated;
