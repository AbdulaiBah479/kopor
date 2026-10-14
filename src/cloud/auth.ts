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

export async function signUp(phone: string, pin: string, name: string) {
  validate(phone, pin);
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.auth.signUp({ email: phoneToEmail(phone), password: pinToPassword(pin), options: { data: { name, phone: intlPhone(phone) } } });
  if (error) throw new Error(error.message.includes('registered') ? 'err.phoneTaken' : error.message);
  if (!data.session) throw new Error('err.confirmDisabled');
  return data.user!;
}

export async function signIn(phone: string, pin: string) {
  validate(phone, pin);
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.auth.signInWithPassword({ email: phoneToEmail(phone), password: pinToPassword(pin) });
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
