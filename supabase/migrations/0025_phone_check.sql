-- Kopor 0025: prove an account's phone number is really the owner's, with a code sent by text message.
-- Free: the texts go out from Kopor's own Android phone through the open-source SMS Gateway for Android app
-- (github.com/capcom6/android-sms-gateway, free cloud relay), set up with the SMS_GATEWAY_* secrets.
-- Server only: codes are stored as hashes, with send and attempt limits; phones learn only "verified or not".

create table if not exists phone_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text,
  expires_at timestamptz,
  attempts int not null default 0,
  sent_today int not null default 0,
  sent_day date,
  hour_start timestamptz,
  sent_hour int not null default 0,
  last_sent timestamptz,
  verified_at timestamptz,
  verified_phone text
);
alter table phone_checks enable row level security;
revoke all on phone_checks from anon, authenticated;

-- "Is my number verified?" for the signed-in account only.
create or replace function kopor_phone_verified() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from phone_checks where user_id = auth.uid() and verified_at is not null
                 and verified_phone = (select kopor_phone_of(email) from auth.users where id = auth.uid()))
$$;
revoke all on function kopor_phone_verified() from public, anon;
grant execute on function kopor_phone_verified() to authenticated;

-- Owner dashboard: show which accounts proved their number.
create or replace function kopor_admin_users(q text default '', lim int default 50, off int default 0) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with u as (
    select u.id, kopor_phone_of(u.email) as phone, u.raw_user_meta_data->>'name' as name, u.created_at, u.last_sign_in_at, u.banned_until,
      exists (select 1 from phone_checks c where c.user_id = u.id and c.verified_at is not null and c.verified_phone = kopor_phone_of(u.email)) as verified
    from auth.users u
    -- Phone search ignores spaces and a leading 0 (076 123 456 finds 23276123456).
    where coalesce(q, '') = '' or kopor_phone_of(u.email) like '%' || regexp_replace(regexp_replace(q, '\D', '', 'g'), '^0', '') || '%' and regexp_replace(q, '\D', '', 'g') <> ''
       or (u.raw_user_meta_data->>'name') ilike '%' || q || '%'
  )
  select jsonb_build_object(
    'total', (select count(*) from u),
    'rows', coalesce((select jsonb_agg(r order by r.created_at desc) from (
      select u.*, (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role)), '[]'::jsonb)
                   from members m join orgs o on o.id = m.org_id where m.user_id = u.id and m.deleted = 0 and m.active = 1 and o.deleted = 0) as businesses
      from u order by u.created_at desc limit least(greatest(lim, 1), 200) offset greatest(off, 0)) r), '[]'::jsonb))
$$;
revoke all on function kopor_admin_users(text, int, int) from public, anon, authenticated;
grant execute on function kopor_admin_users(text, int, int) to service_role;
