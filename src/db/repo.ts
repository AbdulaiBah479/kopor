// Every write goes through here: ids, timestamps, author, dirty flag for sync, and an audit trail.
import { db, type Base, type RowOf, type SyncTable, type Role } from './schema';
import { uuid } from '@/lib/crypto';

export interface Ctx {
  orgId: string;
  memberId: string | null;
  memberName: string;
  branchId: string | null;
  role: Role;
}

export type NewRow<K extends SyncTable> = Omit<RowOf[K], keyof Base> & Partial<Base>;

/** Run several writes atomically. */
export const atomic = <T>(fn: () => Promise<T>) => db.transaction('rw', db.tables, fn);

async function audit(ctx: Ctx, action: 'create' | 'update' | 'delete', entity: SyncTable, entityId: string, summary = '') {
  if (entity === 'audit') return;
  const now = Date.now();
  await db.audit.put({
    id: uuid(), org_id: ctx.orgId, created_at: now, updated_at: now, deleted: 0, created_by: ctx.memberId,
    member_name: ctx.memberName, action, entity, entity_id: entityId, summary: summary.slice(0, 200), at: now, dirty: 1,
  });
}

export async function insert<K extends SyncTable>(ctx: Ctx, table: K, data: NewRow<K>, summary = ''): Promise<RowOf[K]> {
  const now = Date.now();
  const row = {
    id: uuid(), org_id: ctx.orgId, created_at: now, created_by: ctx.memberId, deleted: 0,
    ...data, updated_at: now, dirty: 1,
  } as RowOf[K];
  await db.t(table).put(row);
  await audit(ctx, 'create', table, row.id, summary);
  return row;
}

export async function update<K extends SyncTable>(ctx: Ctx, table: K, id: string, patch: Partial<RowOf[K]>, summary = ''): Promise<RowOf[K]> {
  // Read and write in one transaction: two quick changes to the same record (e.g. two settings saved a moment apart)
  // must not overwrite each other with a stale copy.
  const row = await db.transaction('rw', db.t(table), async () => {
    const cur = await db.t(table).get(id);
    if (!cur || cur.org_id !== ctx.orgId) throw new Error('Record not found');
    const next = { ...cur, ...patch, id, org_id: cur.org_id, updated_at: Math.max(Date.now(), cur.updated_at + 1), dirty: 1 } as RowOf[K];
    await db.t(table).put(next);
    return next;
  });
  await audit(ctx, 'update', table, id, summary);
  return row;
}

/** Soft delete so the deletion syncs to other devices. */
export async function remove<K extends SyncTable>(ctx: Ctx, table: K, id: string, summary = '') {
  await update(ctx, table, id, { deleted: 1 } as Partial<RowOf[K]>, summary);
}

/** All live rows of a table for the current org. */
export async function list<K extends SyncTable>(table: K, orgId: string): Promise<RowOf[K][]> {
  const rows = await db.t(table).where('org_id').equals(orgId).toArray();
  return rows.filter((r) => !r.deleted);
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const m = await db.meta.get(key);
  return (m?.value as T) ?? fallback;
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });
