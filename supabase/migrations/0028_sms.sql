-- Kopor 0028: text messages from the shop's OWN phone (free app: SMS Gateway for Android, github.com/capcom6/
-- android-sms-gateway). Texts go out from the owner's SIM, so they cost the shop a few Leones and Kopor nothing.
--   - automatic reminders to overdue customers (once a day, each customer at most once a week, with a daily limit)
--   - a customer texts BAL to the shop's number and gets their balance back
-- Server only: the gateway login and signing key are sealed; the log keeps who was texted and when, no message text.

alter table org_secrets add column if not exists sms_user text;
alter table org_secrets add column if not exists sms_pass_enc text;
alter table org_secrets add column if not exists sms_sign_enc text;        -- the app's webhook signing key
alter table org_secrets add column if not exists sms_hook_token text;      -- secret in the webhook address
alter table org_secrets add column if not exists sms_auto boolean not null default false;
alter table org_secrets add column if not exists sms_bal boolean not null default true;
alter table org_secrets add column if not exists sms_daily_limit int not null default 20 check (sms_daily_limit between 1 and 200);

create table if not exists sms_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id),
  contact_id uuid,
  kind text not null check (kind in ('reminder', 'balance', 'test')),
  at timestamptz not null default now(),
  ok boolean not null default true
);
create index if not exists sms_log_org_at on sms_log (org_id, at);
alter table sms_log enable row level security;
revoke all on sms_log from anon, authenticated;

create table if not exists sms_runs (day date primary key, at timestamptz not null default now(), sent int not null default 0);
alter table sms_runs enable row level security;
revoke all on sms_runs from anon, authenticated;
