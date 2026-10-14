// PIN accounts. A 6-digit PIN alone is guessable, so the password stored in Supabase Auth is an HMAC of the PIN with a
// server-only secret (KOPOR_PIN_PEPPER). Nobody can sign in by calling Supabase Auth directly: every PIN check goes
// through the auth-pin function, which locks an account after repeated wrong PINs.
import { env } from './util.ts';

let key: CryptoKey | null = null;
async function hmacKey() {
  key ??= await crypto.subtle.importKey('raw', new TextEncoder().encode(env('KOPOR_PIN_PEPPER')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return key;
}

/** Password Supabase Auth stores for this account + PIN. */
export async function pinPassword(email: string, pin: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(`${email.toLowerCase()}:${pin}`));
  return 'kp1.' + btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isPhoneEmail = (e: string) => /^p\d{10,15}@phone\.kopor\.app$/.test(e);
export const isPin = (p: string) => /^\d{6}$/.test(p);
