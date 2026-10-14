// Mobile money / card payments through Monime (licensed by the Bank of Sierra Leone).
// Kopor never holds funds: each business connects its OWN Monime account. Secrets live only in the
// Supabase Edge Function (supabase/functions/monime); the phone never sees them.
import { getSupabase } from './supabase';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke('monime', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const connectMonime = (orgId: string, spaceId: string, token: string) => call<{ ok: true }>({ action: 'connect', orgId, spaceId, token });
export const monimeStatus = (orgId: string) => call<{ connected: boolean; mode?: string }>({ action: 'status', orgId });
export const disconnectMonime = (orgId: string) => call<{ ok: true }>({ action: 'disconnect', orgId });

/** Hosted checkout link (mobile money, card, bank) for an invoice. */
export const createCheckout = (orgId: string, invoiceId: string) => call<{ url: string; requestId: string }>({ action: 'checkout', orgId, invoiceId });

/** Hosted checkout link for any amount (Money → Receive). */
export const createPayLink = (orgId: string, args: { amount: number; name: string }) => call<{ url: string; requestId: string }>({ action: 'link', orgId, ...args });

/** USSD payment code the customer dials from any phone, even without internet. */
export const createUssdCode = (orgId: string, args: { invoiceId?: string; groupId?: string; amount: number; name: string; phone?: string }) =>
  call<{ ussdCode: string; requestId: string }>({ action: 'ussd', orgId, ...args });

export const momoProviders = (orgId: string) => call<{ providers: { id: string; name: string }[] }>({ action: 'providers', orgId });

/** Send money out (osusu pot, supplier payment, salary). Owner only, enforced on the server. */
export const createPayout = (orgId: string, args: { amount: number; phone: string; providerId: string; note: string; groupId?: string }) =>
  call<{ status: string; requestId: string }>({ action: 'payout', orgId, ...args });
