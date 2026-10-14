-- Kopor 0008: hardening from the Supabase security advisor.
-- 1) Fixed search_path on every Kopor function, so none can be tricked into using a look-alike object.
-- 2) Helper functions used by row-level security are not callable by signed-out (anon) users.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'kopor\_%' or p.proname in ('claim_invites', 'claim_invite', 'create_member_invite', 'public_invoice'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['kopor_is_pro(uuid)', 'kopor_level(uuid)', 'kopor_member_ids(uuid)', 'kopor_plan_limits()'] loop
    if to_regprocedure('public.' || fn) is not null then
      execute format('revoke execute on function public.%s from public, anon', fn);
      execute format('grant execute on function public.%s to authenticated, service_role', fn);
    end if;
  end loop;
end $$;
