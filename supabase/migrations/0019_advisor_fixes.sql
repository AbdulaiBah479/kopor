-- Kopor 0019: fixes from the database security advisor (splinter), run weekly by .github/workflows/scan.yml.
-- Helper functions get a fixed search_path; the reports trigger function cannot be called from the API.
-- (public_group, public_invoice, public_statement, submit_group_claim and claim_invite are meant to be callable:
-- each one checks a long secret link code or the caller's own account.)

alter function kopor_round_on(date, text, date) set search_path = public, pg_temp;
alter function kopor_due_on(date, text, date) set search_path = public, pg_temp;
revoke execute on function kopor_reports_guard() from public, anon, authenticated;
