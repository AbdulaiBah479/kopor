// LIVE test of PIN recovery codes and guest AI against the real Supabase project in .env.local.
// Creates a throwaway account with a made-up 099… number and deletes it at the end.
import { client, invoke, pinAuth, testEmail } from './_auth.mjs';

let ok = true;
const check = (name, cond, extra = '') => { console.log(cond ? '✓' : '✗', name, extra); if (!cond) ok = false; };
const sb = client(), email = testEmail();
const PIN1 = String(111111), PIN2 = String(222222), PIN3 = String(333333);

const up = await pinAuth(sb, 'signup', email, PIN1, 'Kopor Recovery Test');
check('sign up test account', up.ok, JSON.stringify(up));
const created = await invoke(sb, 'recover', { action: 'create' });
check('recovery code created', /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(created.code ?? ''), created.error ?? '');
await sb.auth.signOut();

const wrong = await invoke(sb, 'recover', { action: 'reset', email, code: 'AAAAA-AAAAA', pin: PIN2 });
check('wrong code is refused', wrong.error === 'errx.recoverBad', JSON.stringify(wrong));
const reset = await invoke(sb, 'recover', { action: 'reset', email, code: created.code.toLowerCase(), pin: PIN2 });
check('right code (any case) sets the new PIN', reset.ok === true, JSON.stringify(reset));
check('old PIN no longer works', (await pinAuth(client(), 'signin', email, PIN1)).error === 'err.login');
check('new PIN signs in', (await pinAuth(sb, 'signin', email, PIN2)).ok);
await sb.auth.signOut();
const reuse = await invoke(sb, 'recover', { action: 'reset', email, code: created.code, pin: PIN3 });
check('used code cannot be reused', reuse.error === 'errx.recoverBad', JSON.stringify(reuse));
await pinAuth(sb, 'signin', email, PIN2);

// A fresh account has no business yet, so it uses the guest AI allowance (answers, or a clear daily-limit message).
const ai = await invoke(sb, 'ai', { messages: [{ role: 'user', content: 'Say OK' }] });
check('AI works for accounts without a business (guest allowance)', !!ai.content || /limit/i.test(ai.error ?? ''), JSON.stringify(ai).slice(0, 120));

const del = await invoke(sb, 'delete-account', {});
check('test account deleted', !del.error, JSON.stringify(del).slice(0, 120));
console.log(ok ? '\nRecovery live test passed' : '\nRecovery live test FAILED');
process.exit(ok ? 0 : 1);
