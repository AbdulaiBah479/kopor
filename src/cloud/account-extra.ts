// Kopor Pro billing and account deletion (Edge Functions: billing, delete-account).
import { getSupabase } from './supabase';

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const startProCheckout = (orgId: string, months: 1 | 12) => invoke<{ url: string }>('billing', { orgId, months });

export async function deleteCloudAccount() {
  await invoke<{ ok: true }>('delete-account', {});
  (await getSupabase())?.auth.signOut();
}
