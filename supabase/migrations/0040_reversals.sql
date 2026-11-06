-- Kopor 0040: mobile money payment reversals. A customer who pays, takes the goods, then asks the network to pull the
-- money back shows up in Monime's records as a "reversal" (Monime sends no message for it). The server looks for
-- them every 10 minutes (push → reversals): the owner gets an alert, a reversed invoice is unpaid again and the
-- customer owes the money again, and a reversed payment link or code is taken out of the cash book.
alter table alerts drop constraint if exists alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('short', 'deleted', 'away', 'left', 'fake', 'refund', 'approval', 'newDevice', 'test', 'reversal'));

-- Each reversal is handled once.
create table if not exists monime_reversals (
  txn_id text primary key,
  org_id uuid not null references orgs(id),
  origin_txn_id text not null default '',
  request_id uuid,
  amount bigint not null default 0,
  at timestamptz not null default now()
);
alter table monime_reversals enable row level security;
revoke all on monime_reversals from anon, authenticated;

-- Server jobs that anyone may start (the 10-minute timer uses the public app key) run at most once per time slot.
create table if not exists job_claims (
  name text not null,
  slot bigint not null,
  primary key (name, slot)
);
alter table job_claims enable row level security;
revoke all on job_claims from anon, authenticated;
