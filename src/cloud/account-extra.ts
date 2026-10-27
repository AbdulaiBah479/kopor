// Kopor Pro billing and account deletion (Edge Functions: billing, delete-account).
import { callFunction, getSupabase } from './supabase';

const invoke = <T,>(fn: string, body: Record<string, unknown>) => callFunction<T>(fn, body);

export const startProCheckout = (orgId: string, months: 1 | 12) => invoke<{ url: string }>('billing', { orgId, months });
export const startProTrial = (orgId: string) => invoke<{ ok: true; until: number }>('billing', { orgId, action: 'trial' });
export const proStatus = () => invoke<{ payments: boolean; trialDays: number }>('billing', { action: 'status' });

export async function deleteCloudAccount() {
  await invoke<{ ok: true }>('delete-account', {});
  (await getSupabase())?.auth.signOut();
}
