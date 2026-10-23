// Backup/restore of one business, optionally encrypted with a password (AES-256-GCM).
import { z } from 'zod';
import { db, SYNC_TABLES, type SyncTable } from '@/db/schema';
import { encryptText, decryptText, type EncryptedBlob } from '@/lib/crypto';
import { AppError } from './book';
import { setSession } from './org';

const BackupSchema = z.object({
  app: z.literal('kopor'),
  version: z.literal(2),
  orgId: z.guid(), // any 8-4-4-4-12 id (zod 4 .uuid() is stricter)
  exportedAt: z.string(),
  tables: z.record(z.string(), z.array(z.looseObject({ id: z.string(), org_id: z.string() }))),
});

export async function exportOrg(orgId: string, password?: string): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const t of SYNC_TABLES) tables[t] = (await db.t(t).where(t === 'orgs' ? 'id' : 'org_id').equals(orgId).toArray()).map(({ dirty: _d, ...r }) => r);
  const json = JSON.stringify({ app: 'kopor', version: 2, orgId, exportedAt: new Date().toISOString(), tables });
  return password ? JSON.stringify(await encryptText(json, password)) : json;
}

export const isEncrypted = (text: string) => { try { return JSON.parse(text).kopor === 'encrypted-backup'; } catch { return false; } };

/** Restores (merges) a backup. Newer records win, so restoring an old file never overwrites newer work. */
export async function importOrg(text: string, password?: string): Promise<string> {
  let raw: unknown;
  try {
    const parsed = JSON.parse(text);
    raw = parsed.kopor === 'encrypted-backup' ? JSON.parse(await decryptText(parsed as EncryptedBlob, password ?? '')) : parsed;
  } catch (e) { throw e instanceof Error && e.message.includes('password') ? new AppError('err.backupPassword') : new AppError('err.backupFile'); }
  const data = BackupSchema.safeParse(raw);
  if (!data.success) throw new AppError('err.backupFile');
  const { orgId, tables } = data.data;
  await db.transaction('rw', db.tables, async () => {
    for (const t of SYNC_TABLES) {
      for (const row of (tables[t] ?? []) as { id: string; org_id: string; updated_at: number }[]) {
        if (row.org_id !== orgId) continue;
        const cur = await db.t(t as SyncTable).get(row.id);
        if (!cur || (cur.updated_at ?? 0) < row.updated_at) await db.t(t as SyncTable).put({ ...row, dirty: 1 } as never);
      }
    }
  });
  const owner = (tables.members ?? []).find((m) => (m as { role?: string }).role === 'owner') as { id: string } | undefined;
  if (owner) await setSession({ orgId, memberId: owner.id, branchId: null });
  return orgId;
}
