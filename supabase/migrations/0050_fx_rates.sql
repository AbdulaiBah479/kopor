-- Kopor 0050: the US dollar rate, kept on the server (supabase/functions/rates) so every phone uses the same, current
-- figure and the outside services are asked at most once an hour. One row per source; no phone reads it directly.
create table if not exists fx_rates (
  source text primary key,              -- 'bsl' (Bank of Sierra Leone, official), 'erapi', 'currencyapi'
  rate numeric not null check (rate > 0), -- Leones (SLE) for one US dollar
  rate_date date not null,              -- the day the source says the rate is for
  fetched_at timestamptz not null default now()
);
alter table fx_rates enable row level security;
revoke all on fx_rates from anon, authenticated;
