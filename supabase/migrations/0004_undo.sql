-- v3: anyone may undo (soft-delete) their OWN money/stock record within 10 minutes of creating it.
-- Older records, and other people's records, still need a manager or owner.
create or replace function kopor_no_cashier_delete() returns trigger language plpgsql as $$
declare now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if new.deleted = 1 and old.deleted = 0 and coalesce(auth.role(), '') <> 'service_role' and kopor_level(new.org_id) < 2 then
    if old.created_by in (select kopor_member_ids(old.org_id)) and now_ms - old.created_at < 600000 then
      return new;
    end if;
    raise exception 'Only managers and owners can delete records';
  end if;
  return new;
end $$;
