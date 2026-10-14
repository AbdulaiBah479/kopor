// Owner dashboard access (supabase/functions/admin). Only phones listed in the KOPOR_ADMIN_PHONES secret are admins.
import { getSupabase } from './supabase';

export async function adminCall<T>(action: string): Promise<T> {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data, error } = await sb.functions.invoke('admin', { body: { action } });
  if (error) throw new Error((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message);
  return data as T;
}

/** True when the signed-in account may open the owner dashboard (false when signed out or offline). */
export async function isAppAdmin(): Promise<boolean> {
  const sb = await getSupabase();
  if (!sb || !(await sb.auth.getSession()).data.session) return false;
  return adminCall<{ admin: boolean }>('whoami').then((r) => r.admin).catch(() => false);
}