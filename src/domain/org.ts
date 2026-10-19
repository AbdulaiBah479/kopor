// Businesses, branches, staff, device session and PIN lock.
import { db, SYNC_TABLES, type Member, type Org, type Role } from '@/db/schema';
import { insert, update, atomic, getMeta, setMeta, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { uuid, hashPin, verifyPin } from '@/lib/crypto';
import { AppError } from './book';
import { FREE_LIMITS, isPro } from './plan';

export interface Session { orgId: string; memberId: string; branchId: string | null }
export const getSession = () => getMeta<Session | null>('session', null);
export const setSession = (s: Session | null) => setMeta('session', s);

export interface OrgInput { name: string; type: string; owner: string; phone: string; currency?: string; country_code?: string }

export async function createOrg(input: OrgInput, userId: string | null = null): Promise<{ org: Org; owner: Member }> {
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  const id = uuid(), now = Date.now();
  const ownerId = uuid();
  const ctx: Ctx = { orgId: id, memberId: ownerId, memberName: input.owner || 'Owner', branchId: null, role: 'owner' };
  return atomic(async () => {
    const org: Org = {
      id, org_id: id, created_at: now, updated_at: now, deleted: 0, created_by: ownerId, dirty: 1,
      name: input.name.trim(), type: input.type, currency: input.currency || 'Le', country_code: input.country_code || '232',
      phone: input.phone.trim(), address: '', momo_number: '', owner_name: input.owner.trim(), reminder_days: 2, plan: 'free',
      plan_until: null, tax_rate: 0, tax_inclusive: 1, tax_id: '', receipt_footer: '',
    };
    await db.orgs.put(org);
    const owner = await insert(ctx, 'members', { id: ownerId, user_id: userId, name: input.owner.trim() || 'Owner', phone: input.phone.trim(), role: 'owner', branch_id: null, active: 1 }, 'Business created');
    await insert(ctx, 'branches', { name: 'Main', address: '' }, 'Main branch');
    await setSession({ orgId: id, memberId: owner.id, branchId: null });
    return { org, owner };
  });
}

export async function updateOrg(ctx: Ctx, patch: Partial<Org>) {
  assertCan(ctx.role, 'business');
  return update(ctx, 'orgs', ctx.orgId, patch, 'Business settings');
}

export interface MemberInput { name: string; phone: string; role: Role; branch_id: string | null }
export async function saveMember(ctx: Ctx, input: MemberInput, id?: string) {
  assertCan(ctx.role, 'team');
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  if (id) {
    const m = await db.members.get(id);
    if (m?.role === 'owner' && input.role !== 'owner') {
      const owners = (await db.members.where('org_id').equals(ctx.orgId).toArray()).filter((x) => !x.deleted && x.active && x.role === 'owner');
      if (owners.length <= 1) throw new AppError('err.lastOwner');
    }
    return update(ctx, 'members', id, { ...input, name: input.name.trim() }, `Staff ${input.name}: ${input.role}`);
  }
  await assertWithinPlan(ctx.orgId, 'staff');
  return insert(ctx, 'members', { ...input, name: input.name.trim(), user_id: null, active: 1 }, `Added staff ${input.name} (${input.role})`);
}

/** Free plan limits (also enforced in Postgres). */
async function assertWithinPlan(orgId: string, what: 'staff' | 'branches') {
  const org = await db.orgs.get(orgId);
  if (!org || isPro(org)) return;
  const count = what === 'staff'
    ? (await db.members.where('org_id').equals(orgId).toArray()).filter((m) => !m.deleted && m.active).length
    : (await db.branches.where('org_id').equals(orgId).toArray()).filter((b) => !b.deleted).length;
  if (count >= FREE_LIMITS[what]) throw new AppError(what === 'staff' ? 'errx.proStaff' : 'errx.proBranches', { limit: FREE_LIMITS[what] });
}
export async function deactivateMember(ctx: Ctx, id: string) {
  assertCan(ctx.role, 'team');
  if (id === ctx.memberId) throw new AppError('err.removeSelf');
  return update(ctx, 'members', id, { active: 0 }, 'Staff removed');
}
export async function addBranch(ctx: Ctx, name: string, address = '') {
  assertCan(ctx.role, 'team');
  if (!name.trim()) throw new AppError('err.nameRequired');
  await assertWithinPlan(ctx.orgId, 'branches');
  return insert(ctx, 'branches', { name: name.trim(), address }, `Branch ${name}`);
}

/* ---------- PINs (device-local) ---------- */
type Pins = Record<string, string>;
const getPins = () => getMeta<Pins>('pins', {});
export async function setPin(memberId: string, pin: string | null) {
  const pins = await getPins();
  if (pin) {
    if (!/^\d{4,8}$/.test(pin)) throw new AppError('err.pinFormat');
    pins[memberId] = await hashPin(pin);
  } else delete pins[memberId];
  await setMeta('pins', pins);
}
export const hasPin = async (memberId: string) => !!(await getPins())[memberId];
export const anyPin = async () => Object.keys(await getPins()).length > 0;

/** Verifies a PIN with exponential lockout after repeated failures (brute-force protection). */
export async function checkPin(memberId: string, pin: string): Promise<boolean> {
  const state = await getMeta<{ fails: number; until: number }>('pinLock', { fails: 0, until: 0 });
  if (Date.now() < state.until) throw new AppError('err.pinLocked', { seconds: Math.ceil((state.until - Date.now()) / 1000) });
  const stored = (await getPins())[memberId];
  const ok = !!stored && (await verifyPin(pin, stored));
  if (ok) { await setMeta('pinLock', { fails: 0, until: 0 }); return true; }
  const fails = state.fails + 1;
  await setMeta('pinLock', { fails, until: fails >= 5 ? Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (fails - 5)) : 0 });
  return false;
}

/**
 * Remove a business from this phone only: its records, and the PINs of its people (so no lock screen is left
 * behind). Nothing changes online; a business that is backed up comes back by signing in again.
 */
export async function removeOrgFromDevice(orgId: string) {
  const memberIds = (await db.members.where('org_id').equals(orgId).toArray()).map((m) => m.id);
  await db.transaction('rw', db.tables, async () => {
    for (const tb of SYNC_TABLES) await db.t(tb).where(tb === 'orgs' ? 'id' : 'org_id').equals(orgId).delete();
  });
  const pins = await getPins();
  for (const id of memberIds) delete pins[id];
  await setMeta('pins', pins);
  await setMeta('pinLock', { fails: 0, until: 0 });
}

/** Changes made on this phone that have not reached the online backup yet. */
export async function unsyncedCount(orgId: string): Promise<number> {
  let n = 0;
  for (const tb of SYNC_TABLES) n += (await db.t(tb).where(tb === 'orgs' ? 'id' : 'org_id').equals(orgId).filter((r) => r.dirty === 1).count());
  return n;
}
