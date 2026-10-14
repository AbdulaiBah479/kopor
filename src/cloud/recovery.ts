// PIN recovery codes (see supabase/functions/recover). The code is shown once; the server keeps only a hash.
import { getSupabase } from './supabase';
import { phoneToEmail, signIn } from './auth';
import { isValidPhone } from '@/lib/phone';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke('recover', { body });
  // Errors from the function come back in the body ({ error: 'errx.…' }) even for 4xx responses.
  const ctx = (error as { context?: Response } | null)?.context;
  const msg = data?.error ?? (ctx && typeof ctx.json === 'function' ? (await ctx.json().catch(() => null))?.error : null) ?? error?.message;
  if (msg) throw new Error(msg);
  return data as T;
}

export const createRecoveryCode = () => call<{ code: string }>({ action: 'create' }).then((r) => r.code);

/** Set a new PIN with the recovery code, then sign in with it and issue a fresh code (the old one is used up). */
export async function resetPin(phone: string, code: string, pin: string) {
  if (!isValidPhone(phone)) throw new Error('err.phone');
  if (!/^\d{6}$/.test(pin)) throw new Error('err.cloudPin');
  await call({ action: 'reset', email: phoneToEmail(phone), code, pin });
  await signIn(phone, pin);
  return createRecoveryCode();
}
