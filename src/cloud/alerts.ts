// Fraud alerts (supabase/migrations/0032_alerts_weekly.sql): the database makes them when records arrive; any phone
// that just sent records asks the server to send them to owners and managers straight away.
import { getSupabase } from './supabase';

export interface AlertRow { id: number; kind: 'short' | 'deleted' | 'away' | 'left' | 'fake'; who: string; amount: number; detail: string; at: string }

let last = 0;
/** Ask the server to send new alerts now (at most every 20 seconds; never fails the caller). */
export function sendAlertsSoon(orgId: string) {
  if (Date.now() - last < 20_000) return;
  last = Date.now();
  void getSupabase().then((sb) => sb?.functions.invoke('push', { body: { action: 'alerts', orgId } })).catch(() => {});
}

/** The business's latest alerts (owners and managers only; others get none). */
export async function recentAlerts(orgId: string, afterId = 0): Promise<AlertRow[]> {
  const sb = await getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('alerts').select('id, kind, who, amount, detail, at').eq('org_id', orgId).gt('id', afterId)
    .order('id', { ascending: false }).limit(30).abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  return data as AlertRow[];
}
