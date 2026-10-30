-- Kopor 0038: Android app notifications through Firebase Cloud Messaging (FCM). Owners' and managers' phones register
-- here so fraud alerts and the weekly report reach them even when Kopor is closed. Server-only table.
create table if not exists fcm_tokens (
  token text primary key check (length(token) between 20 and 4096),
  org_id uuid not null references orgs(id), user_id uuid not null,
  lang text not null default 'en' check (lang in ('en', 'kri', 'fr')),
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
create index if not exists fcm_tokens_org on fcm_tokens (org_id);
alter table fcm_tokens enable row level security;
revoke all on fcm_tokens from anon, authenticated;
