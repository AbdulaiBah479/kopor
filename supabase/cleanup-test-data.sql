-- Removes the automated test accounts created while testing Kopor's cloud sync, and their test businesses.
-- Run in Supabase -> SQL Editor whenever you want a clean database (for example before launch).
do $$
declare uids uuid[]; oids uuid[]; t text;
begin
  select array_agg(id) into uids from auth.users
  where raw_user_meta_data->>'name' = 'Kopor Cloud Test'
     or email in ('p23299133346@phone.kopor.app', 'p23299072662@phone.kopor.app', 'p23299411107@phone.kopor.app');
  if uids is null then raise notice 'No test accounts found'; return; end if;
  select array_agg(distinct org_id) into oids from members where user_id = any(uids);
  if oids is not null then
    foreach t in array array['audit','closings','payment_requests','invoices','contributions','groups','stock_moves','products','transactions','ledger','contacts','members','branches'] loop
      execute format('delete from %I where org_id = any($1)', t) using oids;
    end loop;
    delete from org_secrets where org_id = any(oids);
    delete from ai_usage where org_id = any(oids);
    delete from orgs where id = any(oids);
  end if;
  delete from auth.users where id = any(uids);
  raise notice 'Removed % test accounts', array_length(uids, 1);
end $$;