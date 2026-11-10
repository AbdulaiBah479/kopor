// Stock count: count what is really on the shelves, item by item. Kopor compares each count with what its records
// say should be there and shows exactly which goods are missing (or extra) and what they are worth, then corrects
// the stock in one go. Missing goods also appear in Fraud watch ("stock taken off"), named after who counted.
import type { Product } from '@/db/schema';
import { atomic, insert, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today } from '@/lib/dates';
import { AppError } from './book';

export interface CountLine { product: Product; expected: number; counted: number; diff: number; value: number }

/** Lines for the items that were counted (counts left empty are not part of this count). */
export function countLines(products: Product[], levels: Map<string, number>, counted: Record<string, number | undefined>): CountLine[] {
  return products.filter((p) => !p.deleted && typeof counted[p.id] === 'number').map((p) => {
    const expected = levels.get(p.id) ?? 0, c = counted[p.id]!;
    const diff = c - expected;
    return { product: p, expected, counted: c, diff, value: Math.round(diff * (p.cost || p.price || 0)) };
  });
}

export function countTotals(lines: CountLine[]) {
  const missing = lines.filter((l) => l.diff < 0), extra = lines.filter((l) => l.diff > 0);
  return {
    checked: lines.length,
    missingItems: missing.length, missingValue: -missing.reduce((s, l) => s + l.value, 0),
    extraItems: extra.length, extraValue: extra.reduce((s, l) => s + l.value, 0),
  };
}

/** Correct the stock to what was counted (managers and owners). */
export async function saveCount(ctx: Ctx, lines: CountLine[]) {
  assertCan(ctx.role, 'stock');
  const changed = lines.filter((l) => l.diff !== 0);
  if (!lines.length) throw new AppError('err.qty');
  await atomic(async () => {
    for (const l of changed) {
      await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: l.product.id, qty: l.diff, reason: 'adjust', ref_id: null, date: today(), expiry: null },
        `Stock count: ${l.product.name} ${l.expected} → ${l.counted}`);
    }
  });
  return countTotals(lines);
}
