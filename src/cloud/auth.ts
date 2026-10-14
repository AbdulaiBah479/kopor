// Phone + PIN accounts. Supabase email/password auth is used under the hood with a synthetic
// address derived from the phone number, so no paid SMS is needed. SMS/WhatsApp OTP can be added later
// by switching to supabase.auth.signInWithOtp({ phone }).
import { intlPhone, isValidPhone } from '@/lib/phone';
import { getSupabase } from './supabase';

export const phoneToEmail = (phone: string, cc = '232') => `p${intlPhone(phone, cc)}@phone.kopor.app`;
// Supabase requires ≥6 character passwords; the prefix also keeps PINs out of common-password lists.
const pinToPassword = (pin: string) => `kopor-pin-${pin}`;

function validate(phone: string, pin: string) {
  if (!isValidPhone(phone)) throw new Error('err.phone');
  if (!/^\d{6}$/.test(pin)) throw new Error('err.cloudPin');
}

type AuthErr = { name?: string; status?: number; message: string } | null;
const isNetworkError = (e: AuthErr) => !!e && (e.name === 'AuthRetryableFetchError' || e.status === 0 || /fetch|network/i.test(e.message));

/** Mobile networks drop often: retry a request that failed only because of the connection (3 tries). */
async function withRetry<T extends { error: AuthErr }>(fn: () => Promise<T>): Promise<T> {
  let res = await fn();
  for (let i = 1; i < 3 && isNetworkError(res.error); i++) {
    await new Promise((r) => setTimeout(r, 1500 * i));
    res = await fn();
  }
  if (isNetworkError(res.error)) throw new Error('errx.offline');
  return res;
}

export async function signUp(phone: string, pin: string, name: string) {
  validate(phone, pin);
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await withRetry(() => sb.auth.signUp({ email: phoneToEmail(phone), password: pinToPassword(pin), options: { data: { name, phone: intlPhone(phone) } } }));
  if (error) throw new Error(error.message.includes('registered') ? 'err.phoneTaken' : error.message);
  if (!data.session) throw new Error('err.confirmDisabled');
  return data.user!;
}

export async function signIn(phone: string, pin: string) {
  validate(phone, pin);
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await withRetry(() => sb.auth.signInWithPassword({ email: phoneToEmail(phone), password: pinToPassword(pin) }));
  if (error) throw new Error('err.login');
  return data.user;
}

export async function signOut() { (await getSupabase())?.auth.signOut(); }

export async function currentUser() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
