-- Kopor 0044: bills and cash plan. The owner's regular bills (rent, school fees, loan repayments...) are kept with the
-- business so Kopor can warn before the money runs short (src/domain/bills.ts). Ordering from the price list and the
-- stock count need no new data: orders go to the shop on WhatsApp, and a count saves ordinary stock corrections.
alter table orgs add column if not exists bills jsonb not null default '[]'::jsonb;
alter table orgs drop constraint if exists orgs_bills_check;
alter table orgs add constraint orgs_bills_check check (jsonb_typeof(bills) = 'array' and jsonb_array_length(bills) <= 50);
