-- Kopor 0020: easy payments. A business that has no Monime account of its own just enters its mobile money number:
-- Kopor's Monime account opens a separate money box (a Monime "financial account") for that business, customers'
-- payments land in it, and Kopor sends each payment on to the owner's number straight away.
-- Server-only table (no client policies), like the rest of org_secrets.

alter table org_secrets add column if not exists easy_fac_id text;       -- the business's money box in Kopor's Monime account
alter table org_secrets add column if not exists payout_phone text;      -- the owner's mobile money number, +232...
alter table org_secrets add column if not exists payout_provider text;   -- m17 Orange Money, m18 Afrimoney
alter table org_secrets add column if not exists easy_on boolean not null default false;
alter table org_secrets add column if not exists easy_auto boolean not null default true; -- send each payment on at once
