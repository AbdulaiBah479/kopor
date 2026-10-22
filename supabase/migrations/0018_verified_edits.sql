-- Kopor 0018: an edited "Confirmed by Monime" record is no longer confirmed. A manager may still correct a record,
-- but if the amount, date, kind or customer changes the badge goes, so it never vouches for numbers Monime did not send.

create or replace function kopor_verified_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare a jsonb; b jsonb; k text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then new.verified_ref := null;
    else
      new.verified_ref := old.verified_ref;
      if old.verified_ref is not null then
        a := to_jsonb(old); b := to_jsonb(new);
        foreach k in array array['amount', 'date', 'type', 'kind', 'method', 'contact_id'] loop
          if (a -> k) is distinct from (b -> k) then new.verified_ref := null; exit; end if;
        end loop;
      end if;
    end if;
  end if;
  return new;
end $$;
