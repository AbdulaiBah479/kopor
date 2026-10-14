// LIVE attack test of PIN protection: no direct sign-ups, PIN useless against Supabase Auth directly,
// lockout after 5 wrong PINs, recovery code unlocks. Creates one throwaway account and deletes it.
import { client, invoke, pinAuth, testEmail } from './_auth.mjs';

let ok = true;
const check = (name, cond, extra = '') => { console.log(cond ? '✓' : '✗', name, extra); if (!cond) ok = false; };
const sb = client(), email = testEmail();
const PIN = String(482913), WRONG = String(111111), NEW = String(735102);

const up = await pinAuth(sb, 'signup', email, PIN);
check('sign up through Kopor', up.ok, JSON.stringify(up));
const code = (await invoke(sb, 'recover', { action: 'create' })).code;
check('recovery code created', /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code ?? ''));
await sb.auth.signOut();

const direct = await client().auth.signUp({ email: testEmail(), password: ['kopor', 'pin', PIN].join('-') });
check('direct sign-up that skips Kopor is refused', !!direct.error, direct.error?.message ?? 'account created!');
const raw = await client().auth.signInWithPassword({ email, password: PIN });
const oldScheme = await client().auth.signInWithPassword({ email, password: ['kopor', 'pin', PIN].join('-') });
check('the PIN does not work directly against Supabase Auth', !!raw.error && !!oldScheme.error);

for (let i = 1; i <= 5; i++) {
  const r = await pinAuth(client(), 'signin', email, WRONG);
  if (i < 5) check(`wrong PIN ${i} refused`, r.error === 'err.login', JSON.stringify(r));
}
const locked = await pinAuth(client(), 'signin', email, PIN);
check('after 5 wrong PINs even the right PIN is locked out', locked.error === 'errx.pinLocked', JSON.stringify(locked));

const reset = await invoke(client(), 'recover', { action: 'reset', email, code, pin: NEW });
check('recovery code resets the PIN', reset.ok === true, JSON.stringify(reset));
const back = await pinAuth(sb, 'signin', email, NEW);
check('reset lifts the lock: new PIN signs in', back.ok, JSON.stringify(back));

const del = await invoke(sb, 'delete-account', {});
check('test account deleted', !del.error, JSON.stringify(del));
console.log(ok ? '\nPIN protection live test passed' : '\nPIN protection live test FAILED');
process.exit(ok ? 0 : 1);
