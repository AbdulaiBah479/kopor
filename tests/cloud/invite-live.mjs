// LIVE test of staff invite codes against the real Supabase project in .env.local.
// Creates three throwaway accounts (owner, staff, attacker) and deletes them at the end.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const mk = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
// Throwaway accounts only; the app turns a 6-digit PIN into the password the same way (src/cloud/auth.ts).
const TEST_PIN = String(135790);
const pinPassword = (pin) => ['kopor', 'pin', pin].join('-');
const num = () => '99' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
let ok = true;
const check = (name, cond, extra = '') => { console.log(cond ? '✓' : '✗', name, extra); if (!cond) ok = false; };
const signUp = async (sb, local, name) => {
  const r = await sb.auth.signUp({ email: `p232${local}@phone.kopor.app`, password: pinPassword(TEST_PIN), options: { data: { name, phone: `232${local}` } } });
  if (r.error) throw r.error;
};

const owner = mk(), staff = mk(), attacker = mk();
const [oNum, sNum, aNum] = [num(), num(), num()];
const ORG = randomUUID(), OWNER_M = randomUUID(), STAFF_M = randomUUID(), t = Date.now();
try {
  await signUp(owner, oNum, 'Kopor Cloud Test');
  let r = await owner.from('orgs').insert({ id: ORG, org_id: ORG, created_at: t, updated_at: t, created_by: OWNER_M, name: 'Kopor Cloud Test' });
  check('owner creates a business', !r.error, r.error?.message ?? '');
  const { data: me } = await owner.auth.getUser();
  r = await owner.from('members').insert([
    { id: OWNER_M, org_id: ORG, created_at: t, updated_at: t, created_by: OWNER_M, user_id: me.user.id, name: 'Owner', phone: '0' + oNum, role: 'owner' },
    { id: STAFF_M, org_id: ORG, created_at: t, updated_at: t, created_by: OWNER_M, name: 'Staff', phone: '0' + sNum, role: 'cashier' },
  ]);
  check('owner adds a staff member by phone', !r.error, r.error?.message ?? '');
  const inv = await owner.rpc('create_member_invite', { p_member: STAFF_M });
  check('owner gets a one-time invite code', /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(inv.data ?? ''), inv.error?.message ?? '');

  await signUp(attacker, aNum, 'Attacker');
  const stolen = await attacker.rpc('claim_invite', { code: inv.data });
  check('someone else with the code but another phone is refused', /inviteBad/.test(stolen.error?.message ?? ''), stolen.error?.message ?? 'joined!');
  check('attacker sees no business data', ((await attacker.from('orgs').select('id')).data ?? []).length === 0);

  await signUp(staff, sNum, 'Staff');
  const auto = await staff.from('orgs').select('id');
  check('signing up with the invited number alone does not join', (auto.data ?? []).length === 0);
  const joined = await staff.rpc('claim_invite', { code: inv.data });
  check('invited staff joins with the code', joined.data === ORG, joined.error?.message ?? '');
  const orgs = await staff.from('orgs').select('name');
  check('staff now sees the business', orgs.data?.[0]?.name === 'Kopor Cloud Test');
  const again = await staff.rpc('claim_invite', { code: inv.data });
  check('the code cannot be used twice', /inviteBad/.test(again.error?.message ?? ''));
} catch (e) { check('unexpected error', false, e.message); }
finally {
  for (const [name, sb] of [['staff', staff], ['attacker', attacker], ['owner', owner]]) {
    const { error } = await sb.functions.invoke('delete-account', { body: {} });
    console.log(error ? `  (could not delete ${name}: ${error.message})` : `  deleted ${name} test account`);
  }
}
console.log(ok ? '\nInvite live test passed' : '\nInvite live test FAILED');
process.exit(ok ? 0 : 1);
