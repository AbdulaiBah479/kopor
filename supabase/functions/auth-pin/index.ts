// Phone + PIN sign-up and sign-in with brute-force protection.
//   { action: 'signup', email, pin, name, phone } -> creates the account, returns a session
//   { action: 'signin', email, pin }              -> returns a session
// The stored password is an HMAC of the PIN (see _shared/pin.ts) and direct sign-ups are disabled in Supabase Auth,
// so every PIN guess has to come through here. 5 wrong PINs lock the account for 15 minutes, doubling each time
// (max 24 h); one network may get at most 60 PINs wrong per day.
import { admin, cors, json, HttpError, env } from '../_shared/util.ts';
import { isPhoneEmail, isPin, pinPassword } from '../_shared/pin.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const FREE_FAILS = 5;
const IP_FAILS_PER_DAY = 60;
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function guard(req: Request, email: string) {
  const db = admin();
  const day = new Date().toISOString().slice(0, 10);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const acct = 'acct:' + await sha256(email);
  const net = 'ip:' + await sha256(`${env('SUPABASE_URL')}|${day}|${ip}`);
  const { data: rows } = await db.from('pin_attempts').select('*').in('key', [acct, net]);
  const a = rows?.find((r) => r.key === acct), n = rows?.find((r) => r.key === net);
  const now = Date.now();
  if (a?.locked_until && new Date(a.locked_until).getTime() > now) throw new HttpError(429, 'errx.pinLocked');
  if ((n?.fails ?? 0) >= IP_FAILS_PER_DAY) throw new HttpError(429, 'errx.pinLocked');
  return {
    async failed() {
      // Failures older than a day are forgotten.
      const fresh = a && now - new Date(a.updated_at).getTime() < 86_400_000 ? a.fails : 0;
      const fails = fresh + 1;
      const lockMin = fails >= FREE_FAILS ? Math.min(15 * 2 ** (fails - FREE_FAILS), 24 * 60) : 0;
      await db.from('pin_attempts').upsert([
        { key: acct, fails, locked_until: lockMin ? new Date(now + lockMin * 60_000).toISOString() : null, updated_at: new Date(now).toISOString() },
        { key: net, fails: (n?.fails ?? 0) + 1, locked_until: null, updated_at: new Date(now).toISOString() },
      ]);
    },
    async succeeded() { await db.from('pin_attempts').delete().eq('key', acct); },
  };
}

async function session(email: string, password: string) {
  const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    const email = String(body.email ?? '').toLowerCase(), pin = String(body.pin ?? '');
    if (!isPhoneEmail(email)) throw new HttpError(400, 'err.phone');
    if (!isPin(pin)) throw new HttpError(400, 'err.cloudPin');
    const password = await pinPassword(email, pin);

    if (body.action === 'signup') {
      const name = String(body.name ?? '').trim().slice(0, 80), phone = String(body.phone ?? '').replace(/\D/g, '').slice(0, 15);
      // At most 20 new accounts per network per day (stops bulk account creation).
      const db = admin();
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
      const su = 'signup:' + await sha256(`${env('SUPABASE_URL')}|${new Date().toISOString().slice(0, 10)}|${ip}`);
      const { data: cap } = await db.from('pin_attempts').select('fails').eq('key', su).maybeSingle();
      if ((cap?.fails ?? 0) >= 20) throw new HttpError(429, 'errx.signupLimit');
      const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, phone } });
      if (error) throw new HttpError(400, /already|registered|exists/i.test(error.message) ? 'err.phoneTaken' : error.message);
      await db.from('pin_attempts').upsert({ key: su, fails: (cap?.fails ?? 0) + 1, updated_at: new Date().toISOString() });
      const s = await session(email, password);
      if (!s) throw new HttpError(500, 'Account created; please sign in');
      return json(s);
    }

    if (body.action === 'signin') {
      const g = await guard(req, email);
      const s = await session(email, password);
      if (!s) { await g.failed(); throw new HttpError(400, 'err.login'); }
      await g.succeeded();
      return json(s);
    }
    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Server error' }, status);
  }
});
