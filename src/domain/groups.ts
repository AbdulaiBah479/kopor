// Osusu (rotating savings: each round one member collects the pot) and dues collection.
import { db, type Group, type GroupMember, type Method } from '@/db/schema';
import { insert, update, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { uuid, randomToken } from '@/lib/crypto';
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

export interface GroupInput {
  name: string; kind: Group['kind']; amount: number; frequency: Group['frequency']; start_date: string; members: GroupMember[];
  target?: number | null; loan_interest?: number;
}
export async function saveGroup(ctx: Ctx, input: GroupInput, id?: string): Promise<Group> {
  assertCan(ctx.role, 'groups');
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  if (!(input.amount > 0)) throw new AppError('err.amount');
  if (input.loan_interest !== undefined && !(input.loan_interest >= 0 && input.loan_interest <= 100)) throw new AppError('err.amount');
  const data = { ...input, name: input.name.trim(), target: input.target || null };
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

/* ---------- Savings & loan groups (VSLA) ----------
 * Record-keeping only: the money stays in the group's box or the treasurer's mobile money. Members save each round,
 * may borrow from the pot at the group's interest rate, and at the end the pot is shared out in proportion to what
 * each member saved (so the interest earned is shared too). */

export function groupMoney(book: Book, g: Group) {
  const saved = book.contributions.filter((c) => c.group_id === g.id).reduce((s, c) => s + c.amount, 0);
  const loans = book.groupLoans.filter((l) => l.group_id === g.id);
  const lent = loans.filter((l) => l.type === 'loan').reduce((s, l) => s + l.amount, 0);
  const interest = loans.filter((l) => l.type === 'loan').reduce((s, l) => s + l.interest, 0);
  const repaid = loans.filter((l) => l.type === 'repay').reduce((s, l) => s + l.amount, 0);
  // Cash actually in the box now; what is still owed to the group; what the group is worth once all loans are repaid.
  return { saved, lent, interest, repaid, owed: lent + interest - repaid, inBox: saved - lent + repaid, worth: saved + interest };
}

export function memberMoney(book: Book, g: Group, memberId: string, now = today()) {
  const saved = book.contributions.filter((c) => c.group_id === g.id && c.member_id === memberId).reduce((s, c) => s + c.amount, 0);
  const loans = book.groupLoans.filter((l) => l.group_id === g.id && l.member_id === memberId);
  const owes = loans.reduce((s, l) => s + (l.type === 'loan' ? l.amount + l.interest : -l.amount), 0);
  const due = owes > 0 ? loans.filter((l) => l.type === 'loan' && l.due_date).map((l) => l.due_date!).sort()[0] ?? null : null;
  return { saved, owes, due, overdue: !!due && due < now };
}

/** Group loans to remind about: overdue, or due within `days` days (members who still owe, with a due date). */
export function loanReminders(book: Book, days: number, now = today()) {
  const limit = addDays(now, days);
  return book.groups.filter((g) => g.kind === 'savings').flatMap((g) => g.members.flatMap((m) => {
    const mm = memberMoney(book, g, m.id, now);
    return mm.owes > 0 && mm.due && mm.due <= limit ? [{ group: g, member: m, owes: mm.owes, due: mm.due, overdue: mm.overdue }] : [];
  })).sort((a, b) => a.due.localeCompare(b.due));
}

/** Flat interest the group charges on a loan (e.g. 10% of Le 1,000 = Le 100). */
export const loanInterest = (g: Group, amount: number) => Math.round((amount * (g.loan_interest ?? 10)) / 100);

export async function lendFromGroup(ctx: Ctx, book: Book, g: Group, input: { memberId: string; amount: number; dueDate: string; note?: string }) {
  assertCan(ctx.role, 'groups');
  if (!(input.amount > 0)) throw new AppError('err.amount');
  const member = g.members.find((m) => m.id === input.memberId);
  if (!member) throw new AppError('err.notFound');
  const { inBox } = groupMoney(book, g);
  if (input.amount > inBox) throw new AppError('errx.potTooSmall', { amount: inBox / 100 });
  return insert(ctx, 'group_loans', {
    group_id: g.id, member_id: member.id, type: 'loan', amount: Math.round(input.amount), interest: loanInterest(g, input.amount),
    date: today(), due_date: input.dueDate || null, note: input.note?.trim() ?? '',
  }, `Loan to ${member.name}: ${input.amount / 100}`);
}

export async function repayToGroup(ctx: Ctx, book: Book, g: Group, memberId: string, amount: number) {
  assertCan(ctx.role, 'record');
  if (!(amount > 0)) throw new AppError('err.amount');
  const { owes } = memberMoney(book, g, memberId);
  if (amount > owes) throw new AppError('errx.repayTooMuch', { amount: owes / 100 });
  const name = g.members.find((m) => m.id === memberId)?.name ?? '';
  return insert(ctx, 'group_loans', { group_id: g.id, member_id: memberId, type: 'repay', amount: Math.round(amount), interest: 0, date: today(), due_date: null, note: '' }, `${name} repaid ${amount / 100}`);
}

/**
 * Share-out: the cash in the box divided in proportion to what each member saved (the VSLA way), so everyone gets their
 * savings back plus their share of the interest. Loans still owed are reported: they should be repaid first.
 */
export function shareOut(book: Book, g: Group) {
  const money = groupMoney(book, g);
  const rows = g.members.map((m) => ({ member: m, ...memberMoney(book, g, m.id) }));
  const totalSaved = rows.reduce((s, r) => s + r.saved, 0);
  const savers = rows.filter((r) => r.saved > 0);
  let given = 0;
  const out = rows.map((r) => {
    // The last saver gets the rounding remainder, so the shares always add up to the cash in the box exactly.
    const last = savers.length > 0 && r === savers[savers.length - 1];
    const share = !totalSaved || !r.saved ? 0 : last ? money.inBox - given : Math.floor((money.inBox * r.saved) / totalSaved);
    given += share;
    return { ...r, share, earned: share - r.saved };
  });
  return { rows: out, inBox: money.inBox, stillOwed: money.owed };
}

/* ---------- Members' "I've paid" claims ---------- */

export const pendingClaims = (book: Book, groupId?: string) =>
  book.groupClaims.filter((c) => c.status === 'pending' && (!groupId || c.group_id === groupId)).sort((a, b) => a.created_at - b.created_at);

/**
 * Approve a member's claim: it becomes a real contribution (for its round) or a loan repayment, exactly as if the
 * treasurer had recorded it. A contribution already recorded for that round is not counted twice.
 */
export async function approveClaim(ctx: Ctx, book: Book, claimId: string) {
  assertCan(ctx.role, 'record');
  return atomic(async () => {
    const c = await db.group_claims.get(claimId);
    if (!c || c.deleted || c.status !== 'pending') throw new AppError('err.notFound');
    const g = book.groups.find((x) => x.id === c.group_id);
    if (!g) throw new AppError('err.notFound');
    const name = g.members.find((m) => m.id === c.member_id)?.name ?? '';
    if (c.kind === 'repay') await repayToGroup(ctx, book, g, c.member_id, c.amount);
    else {
      const round = c.round ?? currentRound(g);
      const already = (await db.contributions.where('group_id').equals(g.id).toArray()).some((x) => !x.deleted && x.member_id === c.member_id && x.round === round);
      if (!already) {
        await insert(ctx, 'contributions', { group_id: g.id, member_id: c.member_id, round, amount: c.amount, date: today(), method: c.method, payment_ref: c.ref || null },
          `${name} paid round ${round} (approved claim)`);
      }
    }
    return update(ctx, 'group_claims', c.id, { status: 'approved' }, `Approved ${name}'s payment ${c.amount / 100}`);
  });
}

export async function rejectClaim(ctx: Ctx, claimId: string) {
  assertCan(ctx.role, 'record');
  return update(ctx, 'group_claims', claimId, { status: 'rejected' }, 'Rejected a payment claim');
}

/** The secret token behind a group's member link. Made on first share; renewing it stops the old link working. */
export async function groupToken(ctx: Ctx, g: Group, renew = false): Promise<string> {
  assertCan(ctx.role, 'record');
  if (g.public_token && !renew) return g.public_token;
  const public_token = randomToken();
  await update(ctx, 'groups', g.id, { public_token }, `${renew ? 'New member link' : 'Member link'} for ${g.name}`);
  return public_token;
}
