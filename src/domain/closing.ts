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

export const lastClosing = (book: Book) =>
  [...book.closings].sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)[0] as Closing | undefined;

export async function closeDay(ctx: Ctx, input: { date?: string; openingFloat: number; counted: number; expected: number; note?: string; momo?: Closing['momo'] }): Promise<Closing> {
  assertCan(ctx.role, 'close');
  if (input.counted < 0) throw new AppError('err.amount');
  const difference = Math.round(input.counted - input.expected);
  return insert(ctx, 'closings', {
    branch_id: ctx.branchId, date: recordDate(ctx, input.date), opening_float: Math.round(input.openingFloat), expected: Math.round(input.expected),
    counted: Math.round(input.counted), difference, note: input.note?.trim() ?? '', momo: input.momo ?? {},
  }, `Day closed: counted ${input.counted / 100}, difference ${difference / 100}`);
}
