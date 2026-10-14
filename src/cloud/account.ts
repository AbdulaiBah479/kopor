// Linking a local (offline) business to a cloud account, and opening cloud businesses on a new phone.
import { db } from '@/db/schema';
import { setSession } from '@/domain/org';
import { markAllDirty, syncNow } from './sync';
import { currentUser } from './auth';

/** Upload a local business to the signed-in account: the current member becomes that user. */
export async function connectOrg(orgId: string, memberId: string) {
  const user = await currentUser();
  if (!user) throw new Error('err.login');
  await db.members.update(memberId, { user_id: user.id, updated_at: Date.now(), dirty: 1 });
  await markAllDirty(orgId);
  await syncNow(orgId);
}

/** Download a cloud business onto this device and open it as the signed-in member. */
export async function openCloudOrg(orgId: string) {
  const user = await currentUser();
  if (!user) throw new Error('err.login');
  await db.orgs.put({ id: orgId, org_id: orgId, created_at: 0, updated_at: 0, deleted: 0, created_by: null, name: '', type: '', currency: 'Le', country_code: '232', phone: '', address: '', momo_number: '', owner_name: '', reminder_days: 2, plan: 'free', dirty: 0 });
  await syncNow(orgId);
  const me = (await db.members.where('org_id').equals(orgId).toArray()).find((m) => m.user_id === user.id && !m.deleted);
  if (!me) throw new Error('err.notMember');
  await setSession({ orgId, memberId: me.id, branchId: me.branch_id });
}
