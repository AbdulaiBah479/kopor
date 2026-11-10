-- Kopor 0045: messages to customers (new stock, offers, opening hours) sent from the shop's own phone count towards
-- the same daily text limit as reminders (supabase/functions/sms, action broadcast).
alter table sms_log drop constraint if exists sms_log_kind_check;
alter table sms_log add constraint sms_log_kind_check check (kind in ('reminder', 'balance', 'test', 'alert', 'weekly', 'broadcast'));
