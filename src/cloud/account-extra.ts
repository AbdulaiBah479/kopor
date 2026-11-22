// Kopor Pro billing and account deletion (Edge Functions: billing, delete-account).
import { callFunction, getSupabase } from './supabase';

const invoke = <T,>(fn: string, body: Record<string, unknown>) => callFunction<T>(fn, body);

export const startProCheckout = (orgId: string, months: 1 | 12) => invoke<{ url: string }>('billing', { orgId, months });
export const startProTrial = (orgId: string) => invoke<{ ok: true; until: number }>('billing', { orgId, action: 'trial' });
export const proStatus = () => invoke<{ payments: boolean; trialDays: number }>('billing', { action: 'status' });
export interface ReferralStatus { code: string | null; invited: number; rewarded: number; pending: number; added: number; joined: boolean; canJoin: boolean; until: number }
/** This business's invite code and rewards (owner only); `join` names the business that invited this one. */
export const referralStatus = (orgId: string, join?: string) => invoke<ReferralStatus>('billing', { orgId, action: 'referral', ...(join ? { join } : {}) });

export async function deleteCloudAccount() {
  await invoke<{ ok: true }>('delete-account', {});
  (await getSupabase())?.auth.signOut();
}
