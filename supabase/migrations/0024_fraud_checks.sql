-- Kopor 0024: checks against fraud and mistakes.
--   1) Close the day also checks mobile money: what the books say came in by Orange Money / Afrimoney / QMoney
--      against what the owner's own phone messages show (catches fake payment screenshots and reversals).
--   2) Attendance the staff cannot fake easily:
--      - where_m: how far (metres) the phone was from the shop when tapping in (only the distance is kept, never the
--        place itself); null when the phone could not tell.
--      - seen_at: when Kopor's server first received the tap-in. Set by the server, so a phone clock turned back
--        cannot hide a late arrival.
--   3) The shop's location (set by the owner) to measure that distance from.

alter table closings add column if not exists momo jsonb not null default '{}'::jsonb;

alter table attendance add column if not exists where_m integer check (where_m is null or where_m >= 0);
alter table attendance add column if not exists seen_at timestamptz;

alter table orgs add column if not exists shop_lat double precision check (shop_lat is null or shop_lat between -90 and 90);
alter table orgs add column if not exists shop_lng double precision check (shop_lng is null or shop_lng between -180 and 180);

create or replace function kopor_attendance_seen() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then new.seen_at := now();
  else new.seen_at := coalesce(old.seen_at, now());
  end if;
  return new;
end $$;
drop trigger if exists attendance_seen on attendance;
create trigger attendance_seen before insert or update on attendance for each row execute function kopor_attendance_seen();
