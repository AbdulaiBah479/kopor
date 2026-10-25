-- Kopor 0026: owner settings for attendance. late_after: tapping in after this time counts as late (default 08:30).
-- away_m: tap-ins further than this many metres from the shop are flagged (default 200).
alter table orgs add column if not exists late_after text check (late_after is null or late_after ~ '^\d{2}:\d{2}$');
alter table orgs add column if not exists away_m integer check (away_m is null or away_m between 50 and 5000);
