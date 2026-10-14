// PIN recovery without SMS. Actions:
//   create (signed in): make a new one-time recovery code; only its salted hash is stored.
//   reset  (public):    sign-in address + recovery code + new PIN -> sets the new PIN. 5 wrong tries lock it for an hour.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { pinPassword } from '../_shared/pin.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read and type
const MAX_TRIES = 5;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const hash = async (salt: string, code: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${code}`)));
const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(10));
  // 32 symbols = exactly 5 bits, so masking a random byte picks each symbol with equal probability (no modulo bias).
  const s = [...r].map((x) => ALPHABET[x & 31]).join('');
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
const equal = (a: string, b: string) => a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const db = admin();

    if (body.action === 'create') {
      const user = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
      const { data: u } = await user.auth.getUser();
      if (!u.user) throw new HttpError(401, 'Not signed in');
      const code = newCode(), salt = crypto.randomUUID();
      await db.from('recovery_codes').upsert({ user_id: u.user.id, code_hash: await hash(salt, normalize(code)), salt, attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
      return json({ code });
    }

    if (body.action === 'reset') {
      // The app sends the same synthetic sign-in address it uses for the phone number (src/cloud/auth.ts).
      const email = String(body.email ?? '').toLowerCase(), code = normalize(String(body.code ?? '')), pin = String(body.pin ?? '');
      if (!/^p\d{10,15}@phone\.kopor\.app$/.test(email) || code.length !== 10 || !/^\d{6}$/.test(pin)) throw new HttpError(400, 'errx.recoverBad');
      const { data: userId } = await db.rpc('kopor_user_by_email', { e: email });
      // Same answer whether or not the account exists, so the form cannot be used to discover accounts.
      if (!userId) throw new HttpError(400, 'errx.recoverBad');
      const { data: rc } = await db.from('recovery_codes').select('*').eq('user_id', userId).maybeSingle();
      if (!rc) throw new HttpError(400, 'errx.recoverBad');
      if (rc.locked_until && new Date(rc.locked_until).getTime() > Date.now()) throw new HttpError(429, 'errx.recoverLocked');
      if (!equal(await hash(rc.salt, code), rc.code_hash)) {
        const attempts = rc.attempts + 1;
        await db.from('recovery_codes').update({ attempts, locked_until: attempts >= MAX_TRIES ? new Date(Date.now() + 3600_000).toISOString() : null }).eq('user_id', userId);
        throw new HttpError(attempts >= MAX_TRIES ? 429 : 400, attempts >= MAX_TRIES ? 'errx.recoverLocked' : 'errx.recoverBad');
      }
      const { error } = await db.auth.admin.updateUserById(userId as string, { password: await pinPassword(email, pin) });
      if (error) throw new Error(error.message);
      // One-time use: the app creates and shows a fresh code right after signing in.
      await db.from('recovery_codes').delete().eq('user_id', userId);
      // A successful reset also lifts any wrong-PIN lock on the account.
      await db.from('pin_attempts').delete().eq('key', 'acct:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))].map((b) => b.toString(16).padStart(2, '0')).join(''));
      return json({ ok: true });
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Server error' }, status);
  }
});
