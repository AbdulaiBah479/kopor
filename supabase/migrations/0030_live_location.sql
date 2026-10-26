-- Kopor 0030: live staff location during working hours (owner switches it on; staff are told and must agree).
--   orgs.track_live: 1 = staff phones share their position while tapped in (never before tap-in or after tap-out).
--   staff_live:      each person's latest position (one row per person).
--   staff_track:     today's route, for managers. Both are deleted after 30 days (kopor_cleanup).
-- Only the person's own phone can send a position, only through kopor_share_location (which checks they are a
-- member, the owner switched it on and they are tapped in now). Owners and managers can see positions; each
-- person can see their own. fake = the phone said the position came from a fake-GPS app; cashiers and viewers cannot see anyone else's.
alter table orgs add column if not exists track_live smallint not null default 0 check (track_live in (0, 1));

create table if not exists staff_live (
  org_id uuid not null references orgs(id), member_id uuid not null,
  lat double precision not null, lng double precision not null, accuracy real not null, fake boolean not null default false,
  at timestamptz not null default now(),
  primary key (org_id, member_id)
);
create table if not exists staff_track (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id), member_id uuid not null,
  lat double precision not null, lng double precision not null, accuracy real not null, fake boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists staff_track_member_at on staff_track (org_id, member_id, at);

alter table staff_live enable row level security;
alter table staff_track enable row level security;
drop policy if exists staff_live_select on staff_live;
drop policy if exists staff_track_select on staff_track;
create policy staff_live_select on staff_live for select
  using (kopor_level(org_id) >= 2 or member_id in (select kopor_member_ids(org_id)));
create policy staff_track_select on staff_track for select
  using (kopor_level(org_id) >= 2 or member_id in (select kopor_member_ids(org_id)));
revoke insert, update, delete on staff_live, staff_track from anon, authenticated;
grant select on staff_live, staff_track to authenticated;

-- Returns 'ok', or why nothing was saved: 'off' (owner has not switched it on), 'not-working' (not tapped in now),
-- 'wait' (sent less than 20 seconds ago).
create or replace function kopor_share_location(o uuid, lat double precision, lng double precision, acc real, fake boolean default false)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare m uuid; last timestamptz;
begin
  if lat is null or lng is null or acc is null or lat not between -90 and 90 or lng not between -180 and 180 or acc not between 0 and 100000 then
    raise exception 'Bad position';
  end if;
  select id into m from members where org_id = o and user_id = auth.uid() and active = 1 and deleted = 0 limit 1;
  if m is null then raise exception 'Not a member of this business'; end if;
  if not exists (select 1 from orgs where id = o and track_live = 1) then return 'off'; end if;
  -- Tapped in and not yet out (today, or since yesterday for a night shift).
  if not exists (select 1 from attendance where org_id = o and member_id = m and deleted = 0 and time_in is not null
                 and time_out is null and date >= current_date - 1) then
    return 'not-working';
  end if;
  select at into last from staff_live where org_id = o and member_id = m;
  if last is not null and last > now() - interval '20 seconds' then return 'wait'; end if;
  insert into staff_live (org_id, member_id, lat, lng, accuracy, fake, at) values (o, m, lat, lng, acc, coalesce(fake, false), now())
    on conflict (org_id, member_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, fake = excluded.fake, at = excluded.at;
  insert into staff_track (org_id, member_id, lat, lng, accuracy, fake) values (o, m, lat, lng, acc, coalesce(fake, false));
  return 'ok';
end $$;
revoke all on function kopor_share_location(uuid, double precision, double precision, real, boolean) from public, anon;
grant execute on function kopor_share_location(uuid, double precision, double precision, real, boolean) to authenticated;

-- Daily clean-up now also deletes positions older than 30 days.
create or replace function kopor_cleanup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n jsonb := '{}'::jsonb; c int;
begin
  delete from ai_usage_anon where day < current_date - 3;                         get diagnostics c = row_count; n := n || jsonb_build_object('ai_guest', c);
  delete from ai_usage where day < current_date - 90;                             get diagnostics c = row_count; n := n || jsonb_build_object('ai', c);
  delete from sms_log where at < now() - interval '180 days';                      get diagnostics c = row_count; n := n || jsonb_build_object('sms_log', c);
  delete from sms_runs where day < current_date - 90;
  delete from push_runs where day < current_date - 90;
  delete from phone_checks where verified_at is null and coalesce(last_sent, now()) < now() - interval '30 days';
                                                                                   get diagnostics c = row_count; n := n || jsonb_build_object('phone_codes', c);
  delete from pin_attempts where locked_until is not null and locked_until < now() - interval '30 days';
  delete from staff_track where at < now() - interval '30 days';                   get diagnostics c = row_count; n := n || jsonb_build_object('positions', c);
  delete from staff_live where at < now() - interval '30 days';
  return n;
end $$;
revoke all on function kopor_cleanup() from public, anon, authenticated;
grant execute on function kopor_cleanup() to service_role;
