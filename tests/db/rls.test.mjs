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
  create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz, raw_user_meta_data jsonb, banned_until timestamptz);
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

await test('attendance: staff mark only themselves; pay is private to managers and owners', async () => {
  const day = (member, status) => q(`insert into attendance (id, org_id, created_at, updated_at, created_by, member_id, date, status, time_in)
    values (gen_random_uuid(), $1, $2, $2, $3, $4, current_date, $5, '08:10') returning id`, [ORG, now(), CASHIER_M, member, status]);
  await as('cashier');
  const mine = (await day(CASHIER_M, 'present')).rows[0].id;
  await q(`update attendance set time_out = '17:00', updated_at = $2 where id = $1`, [mine, now() + 1]);   // tapping out
  await rejects(day(OWNER_M, 'absent'), /row-level security/);                                               // not someone else
  await rejects(q(`insert into staff_pay (id, org_id, created_at, updated_at, created_by, member_id, kind, amount, month, date)
    values (gen_random_uuid(), $1, 1, 1, $2, $2, 'advance', 1000, '2026-10', current_date)`, [ORG, CASHIER_M]), /row-level security/);
  await as('owner');
  await q(`insert into staff_terms (id, org_id, created_at, updated_at, created_by, member_id, pay_type, amount, work_days)
    values (gen_random_uuid(), $1, $2, $2, $3, $4, 'monthly', 2700000, 6)`, [ORG, now(), OWNER_M, CASHIER_M]);
  await q(`insert into staff_pay (id, org_id, created_at, updated_at, created_by, member_id, kind, amount, month, date)
    values (gen_random_uuid(), $1, $2, $2, $3, $4, 'advance', 50000, '2026-10', current_date)`, [ORG, now(), OWNER_M, CASHIER_M]);
  await q(`update attendance set status = 'late', updated_at = $2 where id = $1`, [mine, now() + 2]);           // the owner corrects anyone
  await as('cashier');
  assert.equal((await q('select * from attendance')).rows.length, 1);                                          // the register is visible
  assert.equal((await q('select * from staff_terms')).rows.length, 0, 'cashiers cannot see salaries');
  assert.equal((await q('select * from staff_pay')).rows.length, 0, 'cashiers cannot see advances');
  await as('stranger');
  assert.equal((await q('select * from attendance')).rows.length, 0);
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

await test('statement link shows one customer\'s balance by secret token only, never phone numbers', async () => {
  await as('owner');
  const C1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', C2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  await q(`insert into contacts (id, org_id, created_at, updated_at, created_by, name, phone, public_token) values
           ($1, $3, 1, 1, $4, 'Aminata', '+23276111111', 'stmt_abcdefghijklmnop'), ($2, $3, 1, 1, $4, 'Other', '+23276222222', null)`, [C1, C2, ORG, OWNER_M]);
  await q(`insert into ledger (id, org_id, created_at, updated_at, created_by, contact_id, type, amount, date) values
           (gen_random_uuid(), $1, 1, 1, $2, $3, 'gave', 50000, current_date), (gen_random_uuid(), $1, 2, 2, $2, $3, 'got', 20000, current_date),
           (gen_random_uuid(), $1, 3, 3, $2, $4, 'gave', 99900, current_date)`, [ORG, OWNER_M, C1, C2]);
  await as(null);
  const s = (await q(`select public_statement('stmt_abcdefghijklmnop') as s`)).rows[0].s;
  assert.equal(s.name, 'Aminata');
  assert.equal(Number(s.balance), 30000);
  assert.equal(s.entries.length, 2);
  assert.ok(!JSON.stringify(s).includes('+232'), 'no phone numbers');
  assert.equal((await q(`select public_statement('stmt_wrong_token_00000') as s`)).rows[0].s, null);
  assert.equal((await q(`select public_statement('short') as s`)).rows[0].s, null);
  const none = await q('select * from contacts').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
  assert.ok(none, 'signed-out users must not read contacts');
});

await test('quotations can be saved as invoices with their own status', async () => {
  await as('owner');
  await q(`insert into invoices (id, org_id, created_at, updated_at, created_by, number, customer, items, date, status, public_token)
           values (gen_random_uuid(), $1, 1, 1, $2, 'QUO-0001', 'Hotel', '[]', current_date, 'quote', 'quo_abcdefghijklmnop')`, [ORG, OWNER_M]);
  await rejects(q(`insert into invoices (id, org_id, created_at, updated_at, created_by, number, customer, items, date, status, public_token)
           values (gen_random_uuid(), $1, 1, 1, $2, 'X-1', 'Hotel', '[]', current_date, 'bogus', 'bad_abcdefghijklmnop')`, [ORG, OWNER_M]), /check constraint/);
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
await test('savings & loan groups: managers lend, cashiers cannot; member link shows balances without phone numbers', async () => {
  await as('owner');
  const G = 'abababab-abab-4bab-8bab-abababababab', M1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', M2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
  await q(`insert into groups (id, org_id, created_at, updated_at, created_by, name, kind, amount, frequency, start_date, members, target, public_token)
           values ($1, $2, 1, 1, $3, 'Farmers VSLA', 'savings', 1000, 'weekly', current_date, $4, 50000, 'grp_abcdefghijklmnop')`,
    [G, ORG, OWNER_M, JSON.stringify([{ id: M1, name: 'Mariama', phone: '+23276000001' }, { id: M2, name: 'Sahr', phone: '+23276000002' }])]);
  await q(`insert into contributions (id, org_id, created_at, updated_at, created_by, group_id, member_id, round, amount, date)
           values (gen_random_uuid(), $1, 1, 1, $2, $3, $4, 1, 1000, current_date), (gen_random_uuid(), $1, 1, 1, $2, $3, $5, 1, 1000, current_date)`, [ORG, OWNER_M, G, M1, M2]);
  await q(`insert into group_loans (id, org_id, created_at, updated_at, created_by, group_id, member_id, type, amount, interest, date, due_date)
           values (gen_random_uuid(), $1, 1, 1, $2, $3, $4, 'loan', 1500, 150, current_date, current_date + 28),
                  (gen_random_uuid(), $1, 2, 2, $2, $3, $4, 'repay', 500, 0, current_date, null)`, [ORG, OWNER_M, G, M1]);
  await as('cashier');
  await rejects(q(`insert into group_loans (id, org_id, created_at, updated_at, group_id, member_id, type, amount, date) values (gen_random_uuid(), $1, 1, 1, $2, $3, 'loan', 100, current_date)`, [ORG, G, M1]), /row-level security/);
  await q(`insert into savings_goals (id, org_id, created_at, updated_at, name, target) values (gen_random_uuid(), $1, 1, 1, 'Rent', 300000)`, [ORG]);
  await as('stranger');
  assert.equal((await q('select * from group_loans')).rows.length, 0);
  assert.equal((await q('select * from savings_goals')).rows.length, 0);
  await as(null);
  const g = (await q(`select public_group('grp_abcdefghijklmnop') as g`)).rows[0].g;
  assert.equal(g.name, 'Farmers VSLA');
  assert.equal(Number(g.saved_total), 2000);
  assert.equal(Number(g.lent_out), 1150);                    // 1500 + 150 interest − 500 repaid
  const mariama = g.members.find((m) => m.name === 'Mariama');
  assert.equal(Number(mariama.owes), 1150);
  assert.ok(!JSON.stringify(g).includes('+232'), 'no phone numbers');
  assert.equal((await q(`select public_group('grp_wrong_token_00000') as g`)).rows[0].g, null);
});

await test('members claim payments from the link: only listed members, only pending, limited, staff decide', async () => {
  const G = 'abababab-abab-4bab-8bab-abababababab', M1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  await as(null);
  const claim = (member, extra = {}) => q(`select submit_group_claim($1, $2, $3, $4, $5, $6, $7, $8) as r`,
    [extra.token ?? 'grp_abcdefghijklmnop', member, extra.kind ?? 'contribution', extra.amount ?? 1000, 2, 'orange', 'MP123', '']);
  assert.equal((await claim(M1)).rows[0].r.ok, true);
  await rejects(claim('ffffffff-ffff-4fff-8fff-ffffffffffff'), /not a member/);
  await rejects(claim(M1, { token: 'grp_wrong_token_00000' }), /invalid link/);
  await rejects(claim(M1, { kind: 'loan' }), /invalid claim/);
  for (let i = 0; i < 4; i++) await claim(M1);
  await rejects(claim(M1), /too many claims/);                       // 5 waiting for this member: stop
  const none = await q('select * from group_claims').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
  assert.ok(none, 'signed-out users cannot read claims');
  await as('cashier');
  const rows = (await q(`select id, status from group_claims where group_id = $1`, [G])).rows;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.status === 'pending'));
  await q(`update group_claims set status = 'approved', updated_at = updated_at + 1 where id = $1`, [rows[0].id]);
  await as('stranger');
  assert.equal((await q('select * from group_claims')).rows.length, 0);
});

await test('reminder notifications: server only; the daily digest finds dues and loans correctly', async () => {
  const G = 'abababab-abab-4bab-8bab-abababababab', M1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', M2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
  for (const who of ['owner', null]) {
    await as(who);
    const hidden = await q('select * from push_subscriptions').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
    assert.ok(hidden, 'subscriptions are server only');
    await rejects(q('select * from kopor_push_digest(current_date)'), /permission denied/);
  }
  assert.equal((await q(`select kopor_due_on('2026-01-05', 'weekly', '2026-01-19') as a, kopor_due_on('2026-01-05', 'weekly', '2026-01-20') as b`)).rows[0].a, true);
  assert.equal((await q(`select kopor_round_on('2026-01-05', 'weekly', '2026-01-19') as r`)).rows[0].r, 3);
  assert.equal((await q(`select kopor_due_on('2026-01-31', 'monthly', '2026-02-28') as r`)).rows[0].r, true);   // short month: last day
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const p = 'B' + 'x'.repeat(86), a = 'y'.repeat(22);
  // The VSLA group starts today (weekly): round 1 is due today. Mariama has paid round 1, Sahr has too (earlier test).
  await q(`update groups set start_date = current_date where id = $1`, [G]);
  await q(`delete from contributions where group_id = $1 and member_id = $2`, [G, M2]);
  await q(`insert into push_subscriptions (endpoint, p256dh, auth, scope, org_id, group_id, member_id) values
           ('https://push.example/1', $1, $2, 'member', $3, $4, $5), ('https://push.example/2', $1, $2, 'member', $3, $4, $6),
           ('https://push.example/3', $1, $2, 'org', $3, null, null)`, [p, a, ORG, G, M1, M2]);
  const rows = (await q(`select * from kopor_push_digest(current_date) order by endpoint`)).rows;
  assert.equal(rows.length, 3);
  assert.equal(Number(rows[0].contribution_due), 0);          // Mariama paid this round
  assert.equal(Number(rows[0].loan_owes), 1150);              // her loan from the earlier test
  assert.equal(Number(rows[1].contribution_due), 1000);       // Sahr has not paid: due today
  assert.ok(rows[2].claims_pending >= 0 && rows[2].scope === 'org');
});

await test('"Confirmed by Monime" can only be set by the server, never by a phone', async () => {
  await as('owner');
  const id = (await q(`insert into transactions (id, org_id, created_at, updated_at, created_by, type, category, amount, method, date, items, verified_ref)
                       values (gen_random_uuid(), $1, 1, 1, $2, 'in', 'sale', 500, 'cash', current_date, '[]', 'fake-ref') returning id, verified_ref`, [ORG, OWNER_M])).rows[0];
  assert.equal(id.verified_ref, null);                                  // a phone cannot mark money as confirmed
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await q(`update transactions set verified_ref = 'mon-123', updated_at = 2 where id = $1`, [id.id]);
  await as('owner');
  await q(`update transactions set verified_ref = null, note = 'edited', updated_at = 3 where id = $1`, [id.id]);
  assert.equal((await q('select verified_ref, note from transactions where id = $1', [id.id])).rows[0].verified_ref, 'mon-123'); // and cannot remove it
  await q(`update transactions set amount = 90000, updated_at = 4 where id = $1`, [id.id]);
  assert.equal((await q('select verified_ref from transactions where id = $1', [id.id])).rows[0].verified_ref, null); // a changed amount is no longer confirmed
});

await test('back-office tools are for the server only, and every lookup is exact', async () => {
  for (const who of ['owner', null]) {
    await as(who);
    await rejects(q(`select kopor_admin_account('p23276000000@phone.kopor.app')`), /permission denied/);
    await rejects(q('select kopor_admin_activity()'), /permission denied/);
    const none = await q('select * from admin_log').then((r) => r.rows.length === 0, (e) => /permission denied/.test(e.message));
    assert.ok(none, 'admin log must be hidden');
  }
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const a = (await q(`select kopor_admin_account('P23276000000@phone.kopor.app') as a`)).rows[0].a;
  assert.equal(a.businesses[0].name, 'Fatu Shop');
  assert.equal(a.businesses[0].role, 'owner');
  assert.equal((await q(`select kopor_admin_account('p00000000000@phone.kopor.app') as a`)).rows[0]?.a ?? null, null);
  assert.equal((await q('select kopor_admin_activity() as a')).rows[0].a.length, 14);
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

await test('full owner dashboard: lists and business details for the server only; announcements show only when live', async () => {
  for (const who of [null, 'owner']) {
    await as(who);
    for (const fn of [`kopor_admin_users('', 50, 0)`, `kopor_admin_orgs('', 'new', 50, 0)`, `kopor_admin_org('${ORG}')`, 'kopor_admin_money()', 'kopor_admin_ai()'])
      await rejects(q(`select ${fn}`), /permission denied/, fn);
  }
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const users = (await q(`select kopor_admin_users('', 50, 0) as r`)).rows[0].r;
  assert.equal(users.total, 3);
  assert.ok(users.rows.some((u) => u.phone === '23276000000' && u.businesses.length === 1), 'owner account with its business');
  assert.equal((await q(`select kopor_admin_users('0760 00', 50, 0) as r`)).rows[0].r.total, 1);   // search by phone digits
  const orgs = (await q(`select kopor_admin_orgs('', 'active', 50, 0) as r`)).rows[0].r;
  assert.equal(orgs.total, 1); assert.equal(orgs.rows[0].owner_phone, '23276000000'); assert.ok(orgs.rows[0].records > 0);
  const d = (await q(`select kopor_admin_org($1) as r`, [ORG])).rows[0].r;
  assert.equal(d.org.id, ORG); assert.ok(d.members.length >= 2); assert.equal(d.activity_14d.length, 14); assert.ok(Array.isArray(d.audit));
  const m = (await q('select kopor_admin_money() as r')).rows[0].r;
  assert.equal(m.daily_14d.length, 14);
  assert.equal((await q('select kopor_admin_ai() as r')).rows[0].r.daily_14d.length, 14);

  await q(`insert into announcements (message, created_by) values ('New: easy payments', '23276000000'), ('Old news', 'x')`);
  await q(`update announcements set active = false where message = 'Old news'`);
  await q(`insert into announcements (message, expires_at) values ('Expired', now() - interval '1 hour')`);
  // (the test setup grants every table to everyone; re-apply the migration's column grant, as on the real server)
  await q('revoke all on announcements from anon, authenticated');
  await q('grant select (id, created_at, message, level, active, expires_at) on announcements to anon, authenticated');
  for (const who of [null, 'stranger']) {
    await as(who);
    assert.deepEqual((await q('select message from announcements')).rows.map((r) => r.message), ['New: easy payments']);
    await rejects(q('select created_by from announcements'), /permission denied/);
    await rejects(q(`insert into announcements (message) values ('spam')`), /permission denied|row-level security/);
  }
});

await test('phone check: codes are server-only; an account learns only whether its own number is verified', async () => {
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await q(`insert into phone_checks (user_id, code_hash, verified_at, verified_phone) values ($1, 'x', now(), '23276000000'), ($2, 'secret-hash', null, null)`, [U.owner, U.cashier]);
  // (the test setup grants every table to everyone; re-apply the migration's revoke, as on the real server)
  await q('revoke all on phone_checks from anon, authenticated');
  for (const who of [null, 'owner', 'cashier']) {
    await as(who);
    await rejects(q('select * from phone_checks'), /permission denied/);
  }
  await as('owner');
  assert.equal((await q('select kopor_phone_verified() as v')).rows[0].v, true);
  await as('cashier');
  assert.equal((await q('select kopor_phone_verified() as v')).rows[0].v, false);
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const users = (await q(`select kopor_admin_users('', 50, 0) as r`)).rows[0].r.rows;
  assert.equal(users.find((x) => x.phone === '23276000000').verified, true);
  assert.equal(users.find((x) => x.phone === '23278555777').verified, false);
});

await test('Credit Passport: only the owner makes one; figures come from the server; the link opens until revoked', async () => {
  await as('cashier');
  await rejects(q('select kopor_make_passport($1)', [ORG]), /Only the owner/);
  await as('stranger');
  await rejects(q('select kopor_make_passport($1)', [ORG]), /Only the owner/);
  await as('owner');
  const tok = (await q('select kopor_make_passport($1) as t', [ORG])).rows[0].t;
  assert.ok(tok.length >= 32);
  await rejects(q('select kopor_passport_data($1)', [ORG]), /permission denied/);           // raw figures: server only
  // (the test setup grants every table to everyone; re-apply the migration's column grant, as on the real server)
  await q('reset role');
  await q('revoke all on passports from anon, authenticated');
  await q('grant select (id, org_id, token, created_at, expires_at, revoked) on passports to authenticated');
  await as(null);
  const p = (await q('select public_passport($1) as p', [tok])).rows[0].p;
  assert.equal(p.data.months.length, 6);
  assert.ok(Number(p.data.sales_6m) > 0 && p.data.business.name);
  assert.equal((await q('select public_passport($1) as p', ['x'.repeat(40)])).rows[0].p, null);
  await rejects(q('select * from passports'), /permission denied/);
  await as('stranger');
  assert.equal((await q('select id from passports')).rows.length, 0);
  await as('owner');
  const id = (await q('select id from passports')).rows[0].id;
  await as('cashier');
  await rejects(q('select kopor_revoke_passport($1)', [id]), /not found/);
  await as('owner');
  await q('select kopor_revoke_passport($1)', [id]);
  await as(null);
  assert.equal((await q('select public_passport($1) as p', [tok])).rows[0].p, null);
});

await test('text messages: the phone login, signing key and text log are server-only', async () => {
  // (the test setup grants every table to everyone; re-apply the migration's revokes, as on the real server)
  await q('reset role');
  for (const tbl of ['sms_log', 'sms_runs', 'org_secrets']) await q(`revoke all on ${tbl} from anon, authenticated`);
  for (const who of [null, 'owner', 'cashier']) {
    await as(who);
    for (const tbl of ['sms_log', 'sms_runs', 'org_secrets']) await rejects(q(`select * from ${tbl}`), /permission denied/, tbl);
  }
});

await test('daily clean-up: old guest AI counts and logs go; recent ones stay; only the server may run it', async () => {
  for (const who of [null, 'owner']) { await as(who); await rejects(q('select kopor_cleanup()'), /permission denied/); }
  await q('reset role'); await q(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await q(`insert into ai_usage_anon (key, day, count) values ('old', current_date - 10, 3), ('new', current_date, 1)`);
  await q(`insert into sms_log (org_id, kind, at) values ($1, 'test', now() - interval '200 days'), ($1, 'test', now())`, [ORG]);
  const n = (await q('select kopor_cleanup() as n')).rows[0].n;
  assert.ok(n.ai_guest >= 1 && n.sms_log >= 1);
  assert.deepEqual((await q(`select key from ai_usage_anon where key in ('old', 'new')`)).rows.map((r) => r.key), ['new']);
  assert.equal((await q('select count(*)::int as c from sms_log where org_id = $1', [ORG])).rows[0].c, 1);
});

console.log(`\n${passed} database security checks passed${process.exitCode ? ' (with failures)' : ''}`);
