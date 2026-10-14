// Osusu (rotating savings: each round one member collects the pot) and dues collection.
import { db, type Group, type GroupMember, type Method } from '@/db/schema';
import { insert, update, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { uuid } from '@/lib/crypto';
import { today, addDays, addMonths } from '@/lib/dates';
import { AppError, type Book } from './book';

const STEP = { daily: (d: string, n: number) => addDays(d, n), weekly: (d: string, n: number) => addDays(d, 7 * n), monthly: (d: string, n: number) => addMonths(d, n) };
export const roundDate = (g: Group, r: number) => STEP[g.frequency](g.start_date, r - 1);
export const totalRounds = (g: Group) => (g.kind === 'osusu' ? Math.max(1, g.members.length) : null);

export function currentRound(g: Group, now = today()) {
  const max = totalRounds(g) ?? 1000;
  let r = 1;
  while (r < max && roundDate(g, r + 1) <= now) r++;
  return r;
}
export const collectorFor = (g: Group, r: number): GroupMember | null =>
  g.kind === 'osusu' && g.members.length ? g.members[(r - 1) % g.members.length] : null;

export function roundStatus(book: Book, g: Group, r: number) {
  const paid = book.contributions.filter((c) => c.group_id === g.id && c.round === r);
  const paidIds = new Set(paid.map((c) => c.member_id));
  return {
    paidIds,
    collected: paid.reduce((s, c) => s + c.amount, 0),
    expected: g.amount * g.members.length,
    unpaid: g.members.filter((m) => !paidIds.has(m.id)),
  };
}
export const groupTotal = (book: Book, g: Group) => book.contributions.filter((c) => c.group_id === g.id).reduce((s, c) => s + c.amount, 0);

/** Reliability per member: share of past rounds paid (used for osusu trust scores). */
export function memberReliability(book: Book, g: Group, now = today()) {
  const r = currentRound(g, now);
  const past = Math.max(1, r);
  return new Map(g.members.map((m) => [m.id, book.contributions.filter((c) => c.group_id === g.id && c.member_id === m.id && c.round <= r).length / past]));
}

export function parseMembers(text: string): GroupMember[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, phone = ''] = l.split(/[,;\t]/).map((x) => x.trim());
    return { id: uuid(), name, phone };
  });
}

export interface GroupInput { name: string; kind: Group['kind']; amount: number; frequency: Group['frequency']; start_date: string; members: GroupMember[] }
export async function saveGroup(ctx: Ctx, input: GroupInput, id?: string): Promise<Group> {
  assertCan(ctx.role, 'groups');
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  if (!(input.amount > 0)) throw new AppError('err.amount');
  const data = { ...input, name: input.name.trim() };
  if (id) return update(ctx, 'groups', id, data, `Edited group ${data.name}`);
  return insert(ctx, 'groups', { ...data, payouts: {} }, `New group ${data.name}`);
}

export async function toggleContribution(ctx: Ctx, g: Group, memberId: string, round: number, method: Method = 'cash') {
  assertCan(ctx.role, 'record');
  return atomic(async () => {
    const existing = (await db.contributions.where('group_id').equals(g.id).toArray())
      .find((c) => !c.deleted && c.member_id === memberId && c.round === round);
    const name = g.members.find((m) => m.id === memberId)?.name ?? '';
    if (existing) { await update(ctx, 'contributions', existing.id, { deleted: 1 }, `Unmarked ${name} round ${round}`); return false; }
    await insert(ctx, 'contributions', { group_id: g.id, member_id: memberId, round, amount: g.amount, date: today(), method, payment_ref: null }, `${name} paid round ${round}`);
    return true;
  });
}

export async function markPayout(ctx: Ctx, g: Group, round: number) {
  assertCan(ctx.role, 'groups');
  return update(ctx, 'groups', g.id, { payouts: { ...g.payouts, [round]: today() } }, `Payout round ${round}`);
}
