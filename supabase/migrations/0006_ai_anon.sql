-- Kopor 0006: AI for everyone. People who have not created a cloud account yet (demo, offline-first users) may use
-- AI and voice a few times a day. Usage is counted per hashed network address per day; the address itself is never stored.
-- Only the Edge Function (service role) can read or write this table.

create table if not exists ai_usage_anon (
  key text not null,
  day date not null,
  count int not null default 0,
  primary key (key, day)
);
alter table ai_usage_anon enable row level security;
revoke all on ai_usage_anon from anon, authenticated;

-- Old rows are useless after a day; keep the table small.
create or replace function kopor_ai_anon_cleanup() returns void language sql security definer set search_path = '' as $$
  delete from public.ai_usage_anon where day < current_date - 2
$$;
revoke all on function kopor_ai_anon_cleanup() from public, anon, authenticated;
grant execute on function kopor_ai_anon_cleanup() to service_role;
