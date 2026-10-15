// Runs the real Supabase migrations in an embedded Postgres (PGlite) and attacks the security rules
// as an owner, a cashier and a stranger. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('✓', name); }
  catch (e) { console.log('✗', name, '\n   ', e.message); process.exitCode = 1; }
  finally { await q('reset role'); }
};
const rejects = async (p, re) => { try { await p; } catch (e) { if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`); return; } throw new Error('expected an error'); };

// --- Supabase-compatible auth stub ---
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
`);
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
  grant usage, select on all sequences in schema public to anon, authenticated, service_role;
`);

const U = { owner: '11111111-1111-4111-8111-111111111111', cashier: '33333333-3333-4333-8333-333333333333', stranger: '22222222-2222-4222-8222-222222222222' };
await q(`insert into auth.users (id, email) values ($1, 'p23276000000@phone.kopor.app'), ($2, 'p23278555777@phone.kopor.app'), ($3, 'p23299999999@phone.kopor.app')`, [U.owner, U.cashier, U.stranger]);
const as = async (who) => {
  await q('reset role');
  await q(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)`, [who ? U[who] : '', who ? 'authenticated' : 'anon']);
  await q(who ? 'set role authenticated' : 'set role anon');
};
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OWNER_M = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CASHIER_M = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now = () => Date.now();
const base = (id, by = OWNER_M, t = now()) => [id, ORG, t, t, by];

await test('owner creates a business, its owner member and branch', async () => {
  await as('owner');
  await q(`insert into orgs (id, org_id, created_at, updated_at, created_by, name) values ($1, $1, $2, $2, $3, 'Fatu Shop')`, [ORG, now(), OWNER_M]);
  await q(`insert into members (id, org_id, created_at, updated_at, created_by, user_id, name, phone, role) values ($1,$2,$3,$4,$5,$6,'Fatu','076000000','owner')`, [...base(OWNER_M), U.owner]);
  await q(`insert into branches (id, org_id, created_at, updated_at, created_by, name) values (gen_random_uuid(), $1, $2, $2, $3, 'Main')`, [ORG, now(), OWNER_M]);
  const { rows } = await q('select owner_user_id, plan from orgs');
  assert.equal(rows[0].owner_user_id, U.owner);
});

await test('a stranger cannot see or write into the business', async () => {
  await as('stranger');
  assert.equal((await q('select * from orgs')).rows.length, 0);
  assert.equal((await q('select * from members')).rows.length, 0);
  await rejects(q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, 1, 1, null, 'in', 'sale', 100, 'cash', current_date)`, [ORG]), /row-level security/);
  await rejects(q(`insert into members (id, org_id, created_at, updated_at, user_id, name, role) values (gen_random_uuid(), $1, 1, 1, $2, 'Me', 'owner')`, [ORG, U.stranger]));
});

await test('staff join only with the owner\'s invite code AND the invited phone number', async () => {
  await as('owner');
  await q(`insert into members (id, org_id, created_at, updated_at, created_by, name, phone, role) values ($1,$2,$3,$4,$5,'Sorie','078 555 777','cashier')`, base(CASHIER_M));
  // Signing up with the invited number is no longer enough on its own.
  await as('cashier');
  assert.equal((await q('select claim_invites() as n')).rows[0].n, 0);
  assert.equal((await q('select * from orgs')).rows.length, 0);
  // Only the owner can create an invite code.
  await rejects(q('select create_member_invite($1)', [CASHIER_M]), /inviteRole/);
  await as('stranger');
  await rejects(q('select create_member_invite($1)', [CASHIER_M]), /inviteRole/);
  await as('owner');
  const code = (await q('select create_member_invite($1) as c', [CASHIER_M])).rows[0].c;
  assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  // The code is useless with a different phone number, and a wrong code is refused.
  await as('stranger');
  await rejects(q('select claim_invite($1)', [code]), /inviteBad/);
  await as('cashier');
  await rejects(q('select claim_invite($1)', ['0000-0000-0000']), /inviteBad/);
  // Right person + right code (any case or spacing) joins, once.
  assert.equal((await q('select claim_invite($1) as o', [code.toLowerCase().replace(/-/g, ' ')])).rows[0].o, ORG);
  assert.equal((await q('select name from orgs')).rows[0].name, 'Fatu Shop');
  await rejects(q('select claim_invite($1)', [code]), /inviteBad/);
  // Nobody can read the stored code hashes directly.
  const hidden = await q('select * from member_invites').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
  assert.ok(hidden, 'invite hashes must not be readable');
});

let cashierTxn;
await test('cashier records sales, can undo only fresh own entries, cannot manage stock or change roles', async () => {
  await as('cashier');
  cashierTxn = (await q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, $2, $2, $3, 'in', 'sale', 5000, 'cash', current_date) returning id`, [ORG, now(), CASHIER_M])).rows[0].id;
  await q(`update transactions set note = 'retry', updated_at = $2 where id = $1`, [cashierTxn, now() + 1]); // re-saving own row is allowed
  // Undo within 10 minutes of creating it: allowed.
  const fresh = (await q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, $2, $2, $3, 'in', 'sale', 700, 'cash', current_date) returning id`, [ORG, now(), CASHIER_M])).rows[0].id;
  await q(`update transactions set deleted = 1, updated_at = $2 where id = $1`, [fresh, now() + 2]);
  // An entry older than 10 minutes: blocked.
  const old = (await q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, $2, $2, $3, 'in', 'sale', 900, 'cash', current_date) returning id`, [ORG, now() - 11 * 60000, CASHIER_M])).rows[0].id;
  await rejects(q(`update transactions set deleted = 1, updated_at = $2 where id = $1`, [old, now() + 3]), /Only managers/);
  await rejects(q(`insert into products (id, org_id, created_at, updated_at, created_by, name) values (gen_random_uuid(), $1, 1, 1, $2, 'Rice')`, [ORG, CASHIER_M]), /row-level security/);
  const esc = await q(`update members set role = 'owner', updated_at = $2 where id = $1`, [CASHIER_M, now() + 5]);
  assert.equal(esc.affectedRows ?? 0, 0); // row is invisible for update: no escalation
  const { rows } = await q(`select role from members where id = $1`, [CASHIER_M]);
  assert.equal(rows[0].role, 'cashier');
});

await test("cashier cannot edit the owner's records", async () => {
  await as('owner');
  const id = (await q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, $2, $2, $3, 'out', 'rent', 9000, 'cash', current_date) returning id`, [ORG, now(), OWNER_M])).rows[0].id;
  await as('cashier');
  const r = await q(`update transactions set amount = 1, updated_at = $2 where id = $1`, [id, now() + 10]);
  assert.equal(r.affectedRows ?? 0, 0);
  await as('owner');
  assert.equal((await q('select amount from transactions where id = $1', [id])).rows[0].amount, 9000);
});

await test('last writer wins: an older update is ignored, revisions always increase', async () => {
  await as('owner');
  const before = (await q('select rev, updated_at from transactions where id = $1', [cashierTxn])).rows[0];
  await q(`update transactions set note = 'stale', updated_at = 5 where id = $1`, [cashierTxn]);
  const after = (await q('select note, rev from transactions where id = $1', [cashierTxn])).rows[0];
  assert.equal(after.note, 'retry');
  await q(`update transactions set note = 'fresh', updated_at = $2 where id = $1`, [cashierTxn, Number(before.updated_at) + 100]);
  const fresh = (await q('select note, rev from transactions where id = $1', [cashierTxn])).rows[0];
  assert.equal(fresh.note, 'fresh');
  assert.ok(Number(fresh.rev) > Number(before.rev));
});

await test('clients cannot move rows to another org, upgrade the plan, or read secrets', async () => {
  await as('owner');
  await q(`update transactions set org_id = gen_random_uuid(), updated_at = $2 where id = $1`, [cashierTxn, now() + 200]);
  assert.equal((await q('select org_id from transactions where id = $1', [cashierTxn])).rows[0].org_id, ORG);
  await q(`update orgs set plan = 'pro', updated_at = $2 where id = $1`, [ORG, now() + 300]);
  assert.equal((await q('select plan from orgs')).rows[0].plan, 'free');
  await q('reset role');
  await q(`insert into org_secrets (org_id, monime_space_id, monime_token_enc, webhook_secret) values ($1, 'spc-x', 'sealed', 's')`, [ORG]);
  await as('owner');
  assert.equal((await q('select * from org_secrets')).rows.length, 0);
  await rejects(q(`insert into payment_requests (id, org_id, created_at, updated_at, kind, amount) values (gen_random_uuid(), $1, 1, 1, 'checkout', 100)`, [ORG]), /row-level security/);
});

await test('public invoice link reveals one invoice by secret token only', async () => {
  await as('owner');
  await q(`insert into invoices (id, org_id, created_at, updated_at, created_by, number, customer, items, date, status, public_token)
           values (gen_random_uuid(), $1, 1, 1, $2, 'INV-0001', 'Hotel', '[{"name":"Water","qty":2,"price":500}]', current_date, 'unpaid', 'tok_abcdefghijklmnop')`, [ORG, OWNER_M]);
  await as(null);
  // Signed-out users get nothing: either an empty result or a refusal.
  const none = await q('select * from invoices').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
  assert.ok(none, 'signed-out users must not read invoices');
  const hit = await q(`select * from public_invoice('tok_abcdefghijklmnop')`);
  assert.equal(hit.rows[0].org_name, 'Fatu Shop');
  assert.equal((await q(`select * from public_invoice('tok_wrong_token_000000')`)).rows.length, 0);
  assert.equal((await q(`select * from public_invoice('short')`)).rows.length, 0);
});

await test('audit log is append-only for everyone but the server', async () => {
  await as('owner');
  const id = (await q(`insert into audit (id, org_id, created_at, updated_at, created_by, member_name, action, entity, entity_id, summary, at) values (gen_random_uuid(), $1, 1, 1, null, 'X', 'create', 'transactions', gen_random_uuid(), 'hi', 1) returning id`, [ORG])).rows[0].id;
  const r = await q(`update audit set summary = 'tampered', updated_at = 99 where id = $1`, [id]);
  assert.equal(r.affectedRows ?? 0, 0);
});

await test('only managers/owners can record refunds', async () => {
  await as('cashier');
  await rejects(q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, $2, $2, $3, 'out', 'refund', 500, 'cash', current_date)`, [ORG, now(), CASHIER_M]), /Only managers/);
  await as('owner');
  await q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date) values (gen_random_uuid(), $1, $2, $2, $3, 'out', 'refund', 500, 'cash', current_date)`, [ORG, now(), OWNER_M]);
});

await test('cashier can close the day; a stranger cannot see closings', async () => {
  await as('cashier');
  await q(`insert into closings (id, org_id, created_at, updated_at, created_by, date, expected, counted, difference) values (gen_random_uuid(), $1, $2, $2, $3, current_date, 10000, 9000, -1000)`, [ORG, now(), CASHIER_M]);
  await as('stranger');
  assert.equal((await q('select * from closings')).rows.length, 0);
});

await test('free plan limits are enforced by the server and lifted by Pro', async () => {
  await as('owner');
  await rejects(q(`insert into branches (id, org_id, created_at, updated_at, created_by, name) values (gen_random_uuid(), $1, $2, $2, $3, 'Second')`, [ORG, now(), OWNER_M]), /Free plan allows 1 branch/);
  await q(`insert into members (id, org_id, created_at, updated_at, created_by, name, role) values (gen_random_uuid(), $1, $2, $2, $3, 'Third', 'viewer')`, [ORG, now(), OWNER_M]);
  await rejects(q(`insert into members (id, org_id, created_at, updated_at, created_by, name, role) values (gen_random_uuid(), $1, $2, $2, $3, 'Fourth', 'viewer')`, [ORG, now(), OWNER_M]), /Free plan allows 3 staff/);
  // Owner cannot grant themselves Pro…
  await q(`update orgs set plan = 'pro', plan_until = $2, updated_at = $3 where id = $1`, [ORG, now() + 9e9, now() + 400]);
  assert.equal((await q('select plan from orgs')).rows[0].plan, 'free');
  // …but the server (payment webhook) can.
  await q('reset role');
  await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await q(`update orgs set plan = 'pro', plan_until = $2, updated_at = $3 where id = $1`, [ORG, now() + 9e9, now() + 500]);
  await as('owner');
  await q(`insert into branches (id, org_id, created_at, updated_at, created_by, name) values (gen_random_uuid(), $1, $2, $2, $3, 'Second')`, [ORG, now(), OWNER_M]);
});

await test('owner dashboard numbers are for the server only, and contain no personal data', async () => {
  for (const who of [null, 'owner', 'stranger']) { await as(who); await rejects(q('select kopor_admin_stats()'), /permission denied/); }
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const s = (await q('select kopor_admin_stats() as s')).rows[0].s;
  assert.equal(s.accounts, 3); assert.equal(s.businesses, 1); assert.equal(s.signups_14d.length, 14);
  assert.ok(!JSON.stringify(s).match(/Fatu|Sorie|0760|0785/), 'no names or phone numbers');
});

await test('anyone can send a problem report or complaint, nobody but the server can read them', async () => {
  await as(null);
  await q(`insert into reports (kind, message, about) values ('abuse', 'This business sent me rude reminders', 'Fatu Shop')`);
  const none = await q('select * from reports').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
  assert.ok(none, 'signed-out users must not read reports');
  await rejects(q(`insert into reports (kind, message, status) values ('bug', 'Pretend this is solved', 'resolved')`));
  await rejects(q(`insert into reports (kind, message, reply) values ('bug', 'Fake reply here', 'we fixed it')`));
  await rejects(q(`insert into reports (kind, message) values ('bug', 'no')`)); // too short
  await as('cashier');
  await q(`insert into reports (kind, message) values ('money', 'The total on my receipt looks wrong')`);
  const hidden = await q('select * from reports').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
  assert.ok(hidden, 'signed-in users must not read reports either');
  await rejects(q(`update reports set status = 'resolved'`).then((r) => { if (r.affectedRows) throw new Error('updated'); throw new Error('no-op'); }));
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  assert.equal((await q('select count(*)::int as n from reports')).rows[0].n, 2);
  assert.equal((await q('select kopor_admin_reports_new() as n')).rows[0].n, 2);
});
await test('account deletion removes the user from businesses', async () => {
  await as('cashier');
  await rejects(q(`select kopor_forget_user($1)`, [U.cashier]), /permission denied/);
  await q('reset role');
  await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await q(`select kopor_forget_user($1)`, [U.cashier]);
  await as('cashier');
  assert.equal((await q('select * from orgs')).rows.length, 0);
});

console.log(`\n${passed} database security checks passed${process.exitCode ? ' (with failures)' : ''}`);
