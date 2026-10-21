-- Kopor 0017: "Confirmed by Monime". Money that really arrived through Monime is marked with Monime's reference.
-- Only the server (the Monime webhook) can set this mark: phones cannot add it, change it or remove it, so the badge
-- in the app can be trusted to mean real, confirmed money (unlike a record anyone can type in).

alter table transactions add column if not exists verified_ref text;
alter table ledger add column if not exists verified_ref text;

create or replace function kopor_verified_guard() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then new.verified_ref := null; else new.verified_ref := old.verified_ref; end if;
  end if;
  return new;
end $$;
drop trigger if exists transactions_verified_guard on transactions;
create trigger transactions_verified_guard before insert or update on transactions for each row execute function kopor_verified_guard();
drop trigger if exists ledger_verified_guard on ledger;
create trigger ledger_verified_guard before insert or update on ledger for each row execute function kopor_verified_guard();
