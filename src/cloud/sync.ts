// Offline-first sync. Local writes are marked dirty and pushed; remote changes are pulled using a
// server-side revision counter. Conflicts resolve last-writer-wins on updated_at (also enforced by a
// Postgres trigger). Stock and money use append-only rows, so most data never conflicts at all.
import { db, SYNC_TABLES, type SyncTable } from '@/db/schema';
import { getMeta, setMeta } from '@/db/repo';
import { getSupabase } from './supabase';

const PAGE = 500;
const SERVER_ONLY = ['rev', 'owner_user_id'];

export type SyncState = { status: 'off' | 'idle' | 'syncing' | 'error' | 'offline'; lastSync: number | null; error?: string };
let state: SyncState = { status: 'off', lastSync: null };
const listeners = new Set<(s: SyncState) => void>();
export const onSyncState = (fn: (s: SyncState) => void) => { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; };
const emit = (s: Partial<SyncState>) => { state = { ...state, ...s }; listeners.forEach((l) => l(state)); };

/** Mark every row of an org dirty (first upload after creating an account). */
export async function markAllDirty(orgId: string) {
  for (const t of SYNC_TABLES) await db.t(t).where(t === 'orgs' ? 'id' : 'org_id').equals(orgId).modify({ dirty: 1 });
}

async function push(orgId: string) {
  const sb = (await getSupabase())!;
  let pushed = 0;
  for (const t of SYNC_TABLES) {
    if (t === 'payment_requests') continue; // written only by the server
    const rows = (await db.t(t).where('dirty').equals(1).toArray()).filter((r) => r.org_id === orgId);
    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE);
      const payload = chunk.map(({ dirty: _d, ...r }) => r);
      // The audit log is append-only: re-sending an existing entry is a no-op, never an update.
      const opts = { onConflict: 'id', ignoreDuplicates: t === 'audit' };
      let ok = chunk;
      const { error } = await sb.from(t).upsert(payload, opts);
      if (error) {
        // One rejected record (e.g. a permission rule) must never block the rest: retry one by one.
        ok = [];
        for (const r of chunk) {
          const { dirty: _d, ...row } = r;
          const res = await sb.from(t).upsert([row], opts);
          if (res.error) rejected.push(`${t}: ${res.error.message}`); else ok.push(r);
        }
      }
      const sent = new Map(ok.map((r) => [r.id, r.updated_at]));
      if (sent.size) await db.t(t).where('id').anyOf([...sent.keys()]).modify((r) => { if (sent.get(r.id) === r.updated_at) r.dirty = 0; });
      pushed += ok.length;
    }
  }
  return pushed;
}
let rejected: string[] = [];

async function pull(orgId: string) {
  const sb = (await getSupabase())!;
  const cursors = await getMeta<Record<string, number>>(`cursor:${orgId}`, {});
  let pulled = 0;
  for (const t of SYNC_TABLES) {
    for (;;) {
      const q = sb.from(t).select('*').gt('rev', cursors[t] ?? 0).order('rev').limit(PAGE);
      const { data, error } = await (t === 'orgs' ? q.eq('id', orgId) : q.eq('org_id', orgId));
      if (error) throw new Error(`${t}: ${error.message}`);
      if (!data?.length) break;
      await merge(t, data);
      cursors[t] = Number(data[data.length - 1].rev);
      pulled += data.length;
      if (data.length < PAGE) break;
    }
  }
  await setMeta(`cursor:${orgId}`, cursors);
  return pulled;
}

export async function merge(t: SyncTable, remote: Record<string, unknown>[]) {
  await db.transaction('rw', db.t(t), async () => {
    for (const r of remote) {
      const row = { ...r } as Record<string, unknown>;
      for (const k of SERVER_ONLY) delete row[k];
      row.created_at = Number(row.created_at);
      row.updated_at = Number(row.updated_at);
      const local = await db.t(t).get(row.id as string);
      const newer = !local || (row.updated_at as number) > local.updated_at || (!local.dirty && (row.updated_at as number) === local.updated_at);
      if (newer) await db.t(t).put({ ...row, dirty: 0 } as never);
    }
  });
}

let running: Promise<void> | null = null;
export function syncNow(orgId: string): Promise<void> {
  if (running) return running;
  running = (async () => {
    const sb = await getSupabase();
    if (!sb) { emit({ status: 'off' }); return; }
    const { data } = await sb.auth.getSession();
    if (!data.session) { emit({ status: 'off' }); return; }
    if (!navigator.onLine) { emit({ status: 'offline' }); return; }
    emit({ status: 'syncing', error: undefined });
    try {
      rejected = [];
      await push(orgId);
      await pull(orgId);
      if (rejected.length) emit({ status: 'error', lastSync: Date.now(), error: `${rejected.length} not synced: ${rejected[0]}` });
      else emit({ status: 'idle', lastSync: Date.now() });
    } catch (e) {
      emit({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  })().finally(() => { running = null; });
  return running;
}

/** Organisations the signed-in user belongs to (including staff invites claimed by phone number). */
export async function remoteOrgs(): Promise<{ id: string; name: string; role: string }[]> {
  const sb = await getSupabase();
  if (!sb) return [];
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return [];
  await sb.rpc('claim_invites');
  const { data, error } = await sb.from('members').select('org_id, role, orgs(name)').eq('user_id', auth.user.id).eq('active', 1).eq('deleted', 0);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({ id: m.org_id as string, role: m.role as string, name: ((m as unknown as { orgs: { name: string } | null }).orgs?.name) ?? '' }));
}
