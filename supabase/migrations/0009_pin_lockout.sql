-- Kopor 0009: wrong-PIN lockout. Counts failed sign-ins per account (hashed sign-in address) and per network
-- (hashed address, per day). Only the auth-pin Edge Function (service role) reads or writes it.

create table if not exists pin_attempts (
  key text primary key,
  fails int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table pin_attempts enable row level security;
revoke all on pin_attempts from anon, authenticated;
