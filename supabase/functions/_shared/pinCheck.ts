// Checking a phone account's 6-digit PIN outside the app (owner text commands, supabase/functions/sms-webhook), with
// the same lock as signing in (supabase/functions/auth-pin): 5 wrong PINs lock the account for 15 minutes, doubling
// each time (at most 24 hours). Uses the same pin_attempts rows, so wrong guesses here and in the app add up.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import { admin, env } from './util.ts';
import { pinPassword } from './pin.ts';

const FREE_FAILS = 5;
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The account email Kopor uses for a Sierra Leone phone number (+23276123456 -> p23276123456@phone.kopor.app). */
export const phoneEmail = (phone: string) => `p${phone.replace(/\D/g, '')}@phone.kopor.app`;

/** The user id when the PIN is right; 'locked' or 'wrong' otherwise. */
export async function checkPhonePin(phone: string, pin: string): Promise<{ userId: string } | 'locked' | 'wrong'> {
  if (!/^\d{6}$/.test(pin)) return 'wrong';
  const db = admin();
  const email = phoneEmail(phone);
  const key = 'acct:' + await sha256(email);
  const { data: a } = await db.from('pin_attempts').select('*').eq('key', key).maybeSingle();
  const now = Date.now();
  if (a?.locked_until && new Date(a.locked_until).getTime() > now) return 'locked';
  const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email, password: await pinPassword(email, pin) });
  if (data?.user) {
    await db.from('pin_attempts').delete().eq('key', key);
    await anon.auth.signOut().catch(() => {});
    return { userId: data.user.id };
  }
  const fresh = a && now - new Date(a.updated_at).getTime() < 86_400_000 ? a.fails : 0;
  const fails = fresh + 1;
  const lockMin = fails >= FREE_FAILS ? Math.min(15 * 2 ** (fails - FREE_FAILS), 24 * 60) : 0;
  await db.from('pin_attempts').upsert({ key, fails, locked_until: lockMin ? new Date(now + lockMin * 60_000).toISOString() : null, updated_at: new Date(now).toISOString() });
  return 'wrong';
}
