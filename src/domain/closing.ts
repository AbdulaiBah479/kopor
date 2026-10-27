// End-of-day cash close: compare the cash the books say should be in the drawer with what was counted.
import type { Closing } from '@/db/schema';
import { insert, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today } from '@/lib/dates';
import { AppError, type Book } from './book';
import { recordDate } from './guard';

/**
 * Cash in the drawer by the books: opening float + cash sales − cash expenses − cash refunds.
 * Debt repayments don't record a payment method, so they are shown separately for the user to add if paid in cash.
 */
export function expectedCash(book: Book, date = today(), openingFloat = 0) {
  let sales = 0, out = 0;
  for (const t of book.txns) {
    if (t.date !== date || t.method !== 'cash') continue;
    if (t.type === 'in') sales += t.amount; else out += t.amount;
  }
  const repaid = book.ledger.filter((e) => e.date === date && e.type === 'got' && e.ref_type !== 'transaction' && e.ref_type !== 'invoice')
    .reduce((s, e) => s + e.amount, 0);
  return { openingFloat, sales, out, repaid, expected: openingFloat + sales - out };
}

export const MOMO = ['orange', 'afrimoney', 'qmoney'] as const;

/** Mobile money the books say came in today, per network: sales paid that way, less money paid out that way. */
export function expectedMomo(book: Book, date = today()) {
  const out: Partial<Record<(typeof MOMO)[number], number>> = {};
  for (const t of book.txns) {
    if (t.date !== date || !(MOMO as readonly string[]).includes(t.method)) continue;
    const k = t.method as (typeof MOMO)[number];
    out[k] = (out[k] ?? 0) + (t.type === 'in' ? t.amount : -t.amount);
  }
  return out;
}

/** The last end-of-day close (handovers between cashiers do not count as closing the day). */
export const lastClosing = (book: Book) =>
  [...book.closings].filter((c) => c.kind !== 'handover').sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)[0] as Closing | undefined;

/**
 * Cash that should be in the drawer now, counted from the last count today (a handover), or from the start of the
 * day: what was handed over (or the opening float) + cash sales − cash paid out since then.
 */
export function cashSinceLastCount(book: Book, date = today(), openingFloat = 0) {
  const handovers = book.closings.filter((c) => !c.deleted && c.kind === 'handover' && c.date === date).sort((a, b) => b.created_at - a.created_at);
  const last = handovers[0];
  const since = last?.created_at ?? 0;
  let sales = 0, out = 0;
  for (const t of book.txns) {
    if (t.deleted || t.date !== date || t.method !== 'cash' || t.created_at <= since) continue;
    if (t.type === 'in') sales += t.amount; else out += t.amount;
  }
  const start = last ? last.counted : openingFloat;
  return { start, sales, out, expected: start + sales - out, last };
}

/** Hand the drawer to the next cashier: both count it; any shortage is the outgoing cashier's (and alerts the owner). */
export async function handOver(ctx: Ctx, input: { counted: number; expected: number; to: string; note?: string }): Promise<Closing> {
  assertCan(ctx.role, 'close');
  if (input.counted < 0) throw new AppError('err.amount');
  if (!input.to || input.to === ctx.memberId) throw new AppError('err.handoverTo');
  const difference = Math.round(input.counted - input.expected);
  return insert(ctx, 'closings', {
    branch_id: ctx.branchId, date: today(), opening_float: 0, expected: Math.round(input.expected), counted: Math.round(input.counted),
    difference, note: input.note?.trim() ?? '', momo: {}, kind: 'handover', handed_to: input.to,
  }, `Drawer handed over: counted ${input.counted / 100}, difference ${difference / 100}`);
}

export async function closeDay(ctx: Ctx, input: { date?: string; openingFloat: number; counted: number; expected: number; note?: string; momo?: Closing['momo'] }): Promise<Closing> {
  assertCan(ctx.role, 'close');
  if (input.counted < 0) throw new AppError('err.amount');
  const difference = Math.round(input.counted - input.expected);
  return insert(ctx, 'closings', {
    branch_id: ctx.branchId, date: recordDate(ctx, input.date), opening_float: Math.round(input.openingFloat), expected: Math.round(input.expected),
    counted: Math.round(input.counted), difference, note: input.note?.trim() ?? '', momo: input.momo ?? {},
  }, `Day closed: counted ${input.counted / 100}, difference ${difference / 100}`);
}
