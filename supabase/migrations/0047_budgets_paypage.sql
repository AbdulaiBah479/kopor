-- Kopor 0047: expense budgets and the shop's pay-QR poster.
--
-- 1) Expense budgets: a monthly limit per expense category ({"transport": 50000, ...}, minor units), set by the
--    owner. Kopor warns at 80% and when a category goes over (src/domain/budgets.ts).
alter table orgs add column if not exists budgets jsonb not null default '{}'::jsonb;
alter table orgs drop constraint if exists orgs_budgets_check;
alter table orgs add constraint orgs_budgets_check check (jsonb_typeof(budgets) = 'object');

-- 2) Pay-QR poster: a secret link printed as a QR code. A customer scans it, types the amount and pays through
--    Monime (supabase/functions/monime, actions public-pay-info and public-pay); the sale is recorded when Monime
--    confirms. Renewing the link makes the old poster stop working.
alter table orgs add column if not exists pay_token text unique check (pay_token is null or length(pay_token) >= 32);

create or replace function kopor_pay_token(o uuid, renew boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare tok text;
begin
  if kopor_level(o) < 2 then raise exception 'errx.role'; end if;
  select pay_token into tok from orgs where id = o;
  if tok is null or renew then
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update orgs set pay_token = tok where id = o;
  end if;
  return tok;
end $$;
revoke all on function kopor_pay_token(uuid, boolean) from public, anon;
grant execute on function kopor_pay_token(uuid, boolean) to authenticated;
