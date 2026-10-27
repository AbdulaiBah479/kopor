-- Kopor 0033: a free Kopor Pro trial, once per business (set only by the billing server function).
alter table orgs add column if not exists pro_trial_at timestamptz;

-- The plan, its end date, the owner and the trial date can be changed only by the server (an owner clearing
-- pro_trial_at to get a second trial is undone).
create or replace function kopor_orgs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(auth.role(), '') <> 'service_role' then
      new.owner_user_id := old.owner_user_id; new.plan := old.plan; new.plan_until := old.plan_until; new.pro_trial_at := old.pro_trial_at;
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    new.plan := 'free';
    new.plan_until := null;
    new.pro_trial_at := null;
    new.owner_user_id := auth.uid();
  end if;
  return new;
end $$;
