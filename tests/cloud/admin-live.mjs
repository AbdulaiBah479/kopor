// LIVE check of the owner dashboard: the admin phone sees aggregate numbers; anyone else is refused.
// Requires KOPOR_ADMIN_PHONES to contain 23299000111 while it runs. Deletes its throwaway accounts.
import { client, invoke, pinAuth, testEmail } from './_auth.mjs';

let ok = true;
const check = (name, cond, extra = '') => { console.log(cond ? '✓' : '✗', name, extra); if (!cond) ok = false; };
const PIN = String(864201);
const boss = client(), other = client();
const bossEmail = 'p23299000111@phone.kopor.app';
const signIn = await pinAuth(boss, 'signin', bossEmail, PIN);
if (!signIn.ok) check('admin test account ready', (await pinAuth(boss, 'signup', bossEmail, PIN, 'Kopor Cloud Test')).ok);
check('admin is recognised', (await invoke(boss, 'admin', { action: 'whoami' })).admin === true);
const s = await invoke(boss, 'admin', { action: 'stats' });
check('admin sees the numbers', typeof s.stats?.accounts === 'number' && s.stats.signups_14d?.length === 14, JSON.stringify(s).slice(0, 160));
check('numbers contain no phone numbers', !/\d{9,}/.test(JSON.stringify(s.stats ?? {})));

await pinAuth(other, 'signup', testEmail(), PIN);
check('other accounts are not admins', (await invoke(other, 'admin', { action: 'whoami' })).admin === false);
check('other accounts are refused the numbers', /administrator/.test((await invoke(other, 'admin', { action: 'stats' })).error ?? ''));
check('signed-out visitors are refused', !!(await invoke(client(), 'admin', { action: 'stats' })).error);

for (const sb of [other, boss]) await invoke(sb, 'delete-account', {});
console.log(ok ? '\nOwner dashboard live test passed' : '\nOwner dashboard live test FAILED');
process.exit(ok ? 0 : 1);
