// Prove the account's phone number with a code by text message (supabase/functions/verify-phone).
import { getSupabase } from './supabase';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke('verify-phone', { body });
  if (error) throw new Error((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message);
  return data as T;
}

export const phoneStatus = () => call<{ available: boolean; verified: boolean }>({ action: 'status' });
export const sendPhoneCode = () => call<{ sent?: boolean; to?: string; verified?: boolean }>({ action: 'send' });
export const checkPhoneCode = (code: string) => call<{ verified: boolean }>({ action: 'check', code });
