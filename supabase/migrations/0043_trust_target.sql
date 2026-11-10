-- Kopor 0043: daily sales target. The owner sets how much the shop should sell each day; Home shows how far today
-- has got. (The customer trust score is worked out on the phone from the credit book and needs no new data.)
alter table orgs add column if not exists daily_target bigint check (daily_target is null or daily_target > 0);
