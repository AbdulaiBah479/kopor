-- Wallet: add money (topup), pay another Kopor shop (transfer out / transfer_in) and send to a bank account
-- (kind 'payout' with phone = 'bank:<providerId>:<accountNumber>').
alter table payment_requests drop constraint if exists payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check
  check (kind in ('checkout', 'ussd', 'payout', 'topup', 'transfer', 'transfer_in'));
-- The other side of a shop-to-shop payment (the request on the other business), so both can be finished together.
alter table payment_requests add column if not exists peer_id uuid;
