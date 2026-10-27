// Live staff location (supabase/migrations/0030_live_location.sql). Phones send through kopor_share_location, which
// accepts a position only while the owner has switched this on and the person is tapped in.
import { getSupabase } from './supabase';

export interface LivePos { member_id: string; lat: number; lng: number; accuracy: number; fake: boolean; at: string }
export type ShareResult = 'ok' | 'off' | 'not-working' | 'closed' | 'wait';

const sb = async () => { const s = await getSupabase(); if (!s) throw new Error('err.noCloud'); return s; };

export async function sharePosition(orgId: string, p: { lat: number; lng: number; accuracy: number; fake?: boolean }): Promise<ShareResult> {
  const { data, error } = await (await sb()).rpc('kopor_share_location', { o: orgId, lat: p.lat, lng: p.lng, acc: Math.round(p.accuracy), fake: !!p.fake })
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  return data as ShareResult;
}

/** Everyone's latest position (owners and managers; others get only their own). */
export async function livePositions(orgId: string): Promise<LivePos[]> {
  const { data, error } = await (await sb()).from('staff_live').select('member_id, lat, lng, accuracy, fake, at').eq('org_id', orgId)
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error(error.message);
  return data as LivePos[];
}

/** One person's route today (oldest first). */
export async function routeToday(orgId: string, memberId: string): Promise<LivePos[]> {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const { data, error } = await (await sb()).from('staff_track').select('member_id, lat, lng, accuracy, fake, at')
    .eq('org_id', orgId).eq('member_id', memberId).gte('at', from.toISOString()).order('at').limit(2000);
  if (error) throw new Error(error.message);
  return data as LivePos[];
}
