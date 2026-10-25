// Text messages from the shop's own phone (supabase/functions/sms, SMS Gateway for Android).
import { getSupabase } from './supabase';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke('sms', { body });
  if (error) throw new Error((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message);
  return data as T;
}

export interface SmsStatus { connected: boolean; auto: boolean; bal: boolean; limit: number; signed: boolean; sentToday: number }
export const smsStatus = (orgId: string) => call<SmsStatus>({ action: 'status', orgId });
export const smsConnect = (orgId: string, a: { user: string; pass: string; signingKey: string }) => call<{ ok: true }>({ action: 'connect', orgId, ...a });
export const smsSettings = (orgId: string, a: { auto?: boolean; bal?: boolean; limit?: number; signingKey?: string }) => call<{ ok: true }>({ action: 'settings', orgId, ...a });
export const smsDisconnect = (orgId: string) => call<{ ok: true }>({ action: 'disconnect', orgId });
export const smsTest = (orgId: string) => call<{ ok: true; to: string }>({ action: 'test', orgId });
export const smsRemind = (orgId: string, contactId: string) => call<{ ok: true }>({ action: 'remind', orgId, contactId });
