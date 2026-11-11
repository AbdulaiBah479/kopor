// Expense budgets: the owner sets a monthly limit per expense category (orgs.budgets, migration 0047). Kopor shows how
// much of each is used this month, warns at 80% and when a category goes over, so small daily spending does not
// quietly eat the profit. Buying stock to sell is left out: it is not spending, it comes back as sales.
import type { Ctx } from '@/db/repo';
import { today } from '@/lib/dates';
import { updateOrg } from './org';
import type { Book } from './book';

export const WARN_AT = 0.8;
export interface BudgetLine { category: string; limit: number; spent: number; pct: number; state: 'ok' | 'near' | 'over' }

export function spentByCategory(book: Book, month = today().slice(0, 7)) {
  const out = new Map<string, number>();
  for (const x of book.txns) {
    if (x.deleted || x.type !== 'out' || x.date.slice(0, 7) !== month || x.category === 'refund' || x.category === 'reversal') continue;
    out.set(x.category, (out.get(x.category) ?? 0) + x.amount);
  }
  return out;
}

export function budgetStatus(book: Book, month = today().slice(0, 7)): BudgetLine[] {
  const limits = (book.org.budgets ?? {}) as Record<string, number>;
  const spent = spentByCategory(book, month);
  return Object.entries(limits).filter(([, l]) => Number(l) > 0).map(([category, limit]) => {
    const s = spent.get(category) ?? 0, pct = Math.round((s / limit) * 100);
    return { category, limit, spent: s, pct, state: s > limit ? 'over' : s >= limit * WARN_AT ? 'near' : 'ok' } as BudgetLine;
  }).sort((a, b) => b.pct - a.pct);
}

/** Save the limits; categories left at 0 have no budget. */
export function saveBudgets(ctx: Ctx, limits: Record<string, number>) {
  const clean = Object.fromEntries(Object.entries(limits).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]));
  return updateOrg(ctx, { budgets: clean });
}
