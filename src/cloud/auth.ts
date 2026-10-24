// Phone + PIN accounts. Supabase email/password auth is used under the hood with a synthetic
// address derived from the phone number, so no paid SMS is needed. SMS/WhatsApp OTP can be added later
// by switching to supabase.auth.signInWithOtp({ phone }).
import { intlPhone, isValidPhone } from '@/lib/phone';
import { getSupabase } from './supabase';

export const phoneToEmail = (phone: string, cc = '232') => `p${intlPhone(phone, cc)}@phone.kopor.app`;
function validate(phone: string, pin: string) {
  if (!isValidPhone(phone)) throw new Error('err.phone');
  if (!/^\d{6}$/.test(pin)) throw new Error('err.cloudPin');
}

const isNetwork = (msg: string) => /fetch|network|timeout|load failed|ERR_/i.test(msg);

/**
 * Every PIN check goes through the auth-pin Edge Function, which stores only an HMAC of the PIN and locks an account
 * after repeated wrong PINs (so a 6-digit PIN cannot be guessed). It returns a session, which we install here.
 * Mobile networks drop often, so a request that failed only because of the connection is retried (3 tries).
 */
async function pinAuth(body: Record<string, string>) {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  for (let i = 0; ; i++) {
    const { data, error } = await sb.functions.invoke('auth-pin', { body });
    if (!error && data?.access_token) {
      const { data: s, error: e2 } = await sb.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (e2) throw new Error(e2.message);
      return s.user!;
    }
    const ctx = (error as { context?: Response } | null)?.context;
    const msg: string = data?.error ?? (ctx && typeof ctx.json === 'function' ? (await ctx.json().catch(() => null))?.error : null) ?? error?.message ?? 'err.generic';
    if (isNetwork(msg) && i < 2) { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); continue; }
    throw new Error(isNetwork(msg) ? 'errx.offline' : msg);
  }
}

export async function signUp(phone: string, pin: string, name: string) {
  validate(phone, pin);
  return pinAuth({ action: 'signup', email: phoneToEmail(phone), pin, name, phone: intlPhone(phone) });
}

export async function signIn(phone: string, pin: string) {
  validate(phone, pin);
  return pinAuth({ action: 'signin', email: phoneToEmail(phone), pin });
}
export async function signOut() { (await getSupabase())?.auth.signOut(); }
/** Lost or stolen phone: end the account's sessions on every phone (each must sign in again with the PIN). */
export async function signOutEverywhere() { await (await getSupabase())?.auth.signOut({ scope: 'global' }); }

export async function currentUser() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
