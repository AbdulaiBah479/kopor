-- Kopor 0005: PIN recovery codes (no paid SMS needed).
-- A one-time code is shown to the user once; only a salted SHA-256 hash is stored. Only the Edge Function
-- (service role) can read or write this table: RLS is on and there are no policies for app users.

create table if not exists recovery_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  salt text not null,
  attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table recovery_codes enable row level security;
revoke all on recovery_codes from anon, authenticated;

-- Look up an account by its sign-in address (server only).
create or replace function kopor_user_by_email(e text) returns uuid
language sql security definer set search_path = '' stable as $$
  select id from auth.users where email = lower(e) limit 1
$$;
revoke all on function kopor_user_by_email(text) from public, anon, authenticated;
grant execute on function kopor_user_by_email(text) to service_role;
