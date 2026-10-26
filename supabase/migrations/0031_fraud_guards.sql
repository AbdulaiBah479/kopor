-- Kopor 0031: stop common staff fraud on the server too.
--   credit_limit: owner's limit per customer (minor units, null = none); the app stops cashiers going above it.
--   No back-dating: cashiers (and viewers) can save sales, expenses, credit entries, stock moves and closings only
--   for the day the record was made or the day before (offline phones and after-midnight entries). Putting a record
--   on an older or future day would hide it from that day's cash count. Managers and owners can correct any day.
alter table orgs add column if not exists credit_limit bigint check (credit_limit is null or credit_limit > 0);

create or replace function kopor_no_backdate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare made date := (to_timestamp(new.created_at / 1000.0) at time zone 'UTC')::date;
begin
  -- Managers, owners and the server may correct any day; people outside the business are refused by the access rules.
  if coalesce(auth.role(), '') = 'service_role' or kopor_level(new.org_id) not in (0, 1) then return new; end if;
  -- The phone's own record time must be near the real day too (an offline phone may sync up to 30 days late).
  if made > current_date + 1 or (tg_op = 'INSERT' and made < current_date - 30)
     or new.date < made - 1 or new.date > made + 1 then
    raise exception 'err.backdated' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions', 'ledger', 'stock_moves', 'closings'] loop
    execute format('drop trigger if exists %I on %I', t || '_no_backdate', t);
    execute format('create trigger %I before insert on %I for each row execute function kopor_no_backdate()', t || '_no_backdate', t);
  end loop;
end $$;
