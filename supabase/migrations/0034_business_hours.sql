-- Kopor 0034: business hours for live staff location.
--   open_at / close_at: the business's working hours (HH:MM, Sierra Leone time = UTC). Default 08:00-18:00.
--   work_days: working days as bits, Monday = 1, Tuesday = 2, ... Sunday = 64 (default 63 = Monday to Saturday).
--   track_mode: 'tapin' = share only while tapped in (and never after closing time, even if someone forgot to tap
--               out); 'hours' = share during business hours on working days, tapped in or not.
-- Staff still agree on their own phone first, and nothing is ever shared outside the business hours.
alter table orgs add column if not exists open_at text check (open_at is null or open_at ~ '^\d{2}:\d{2}$');
alter table orgs add column if not exists close_at text check (close_at is null or close_at ~ '^\d{2}:\d{2}$');
alter table orgs add column if not exists work_days smallint check (work_days is null or work_days between 1 and 127);
alter table orgs add column if not exists track_mode text check (track_mode is null or track_mode in ('tapin', 'hours'));

-- Is the business open at time t? (A closing time before the opening time means a night shift past midnight.)
create or replace function kopor_open_now(o uuid, t timestamptz default now()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when x.close_m > x.open_m then
      (x.days & (1 << x.dow)) <> 0 and x.now_m >= x.open_m and x.now_m < x.close_m
    else -- night shift: open until close_m the next morning
      ((x.days & (1 << x.dow)) <> 0 and x.now_m >= x.open_m)
      or ((x.days & (1 << ((x.dow + 6) % 7))) <> 0 and x.now_m < x.close_m)
  end
  from (
    select coalesce(work_days, 63) as days,
      (extract(isodow from t at time zone 'UTC')::int - 1) as dow,
      (extract(hour from t at time zone 'UTC') * 60 + extract(minute from t at time zone 'UTC'))::int as now_m,
      (split_part(coalesce(open_at, '08:00'), ':', 1)::int * 60 + split_part(coalesce(open_at, '08:00'), ':', 2)::int) as open_m,
      (split_part(coalesce(close_at, '18:00'), ':', 1)::int * 60 + split_part(coalesce(close_at, '18:00'), ':', 2)::int) as close_m
    from orgs where id = o
  ) x
$$;
revoke all on function kopor_open_now(uuid, timestamptz) from public, anon;
grant execute on function kopor_open_now(uuid, timestamptz) to authenticated;

create or replace function kopor_share_location(o uuid, lat double precision, lng double precision, acc real, fake boolean default false)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare m uuid; last timestamptz; mode text;
begin
  if lat is null or lng is null or acc is null or lat not between -90 and 90 or lng not between -180 and 180 or acc not between 0 and 100000 then
    raise exception 'Bad position';
  end if;
  select id into m from members where org_id = o and user_id = auth.uid() and active = 1 and deleted = 0 limit 1;
  if m is null then raise exception 'Not a member of this business'; end if;
  select coalesce(track_mode, 'tapin') into mode from orgs where id = o and track_live = 1;
  if mode is null then return 'off'; end if;
  -- Never outside business hours, whatever the mode.
  if not kopor_open_now(o) then return 'closed'; end if;
  -- 'tapin': tapped in and not yet out (today, or since yesterday for a night shift).
  if mode = 'tapin' and not exists (select 1 from attendance where org_id = o and member_id = m and deleted = 0 and time_in is not null
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
