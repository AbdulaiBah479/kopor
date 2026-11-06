// Supplier price watch. Each restock remembers what one item cost (stock_moves.unit_cost, migration 0042), so Kopor
// can warn when a supplier raised the price and suggest a selling price that keeps the same profit margin. Prices move
// fast in Sierra Leone; a shop that keeps its old price after the cost went up quietly loses money on every sale.
import type { Product, StockMove } from '@/db/schema';
import { update, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { daysBetween, today } from '@/lib/dates';
import { AppError, type Book } from './book';

/** A change this big (either way) is worth telling the owner about. */
export const PRICE_CHANGE = 0.1;
const RECENT_DAYS = 45;

export interface PriceFlag {
  product: Product;
  kind: 'loss' | 'up' | 'down';
  oldCost: number; newCost: number; change: number;   // change: 0.15 = 15% dearer
  supplier: string; date: string;
  suggested: number;                                   // selling price that keeps the old margin (0 when not useful)
}

/** Round a price up to a figure people use: whole Le 5 from Le 100, whole Leones below that. */
export const nicePrice = (minor: number) => { const step = minor >= 10_000 ? 500 : 100; return Math.ceil(minor / step) * step; };

/** Purchases of one product that recorded what an item cost, oldest first. */
export const purchasesOf = (moves: StockMove[], productId: string) => moves
  .filter((m) => m.product_id === productId && m.reason === 'restock' && !m.deleted && (m.unit_cost ?? 0) > 0)
  .sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);

export function priceWatch(book: Book, now = today()): PriceFlag[] {
  const out: PriceFlag[] = [];
  for (const p of book.products) {
    if (p.deleted) continue;
    const list = purchasesOf(book.moves, p.id);
    const last = list.at(-1);
    if (!last || daysBetween(last.date, now) > RECENT_DAYS) continue;
    const newCost = last.unit_cost!;
    const prev = list.at(-2);
    const oldCost = prev?.unit_cost ?? newCost;
    const change = oldCost > 0 ? (newCost - oldCost) / oldCost : 0;
    // Keep the margin the owner chose before the change (selling price over the old cost).
    const suggested = p.price > 0 && oldCost > 0 && p.price > oldCost ? nicePrice((p.price * newCost) / oldCost) : 0;
    const base = { product: p, oldCost, newCost, change, supplier: last.supplier ?? '', date: last.date };
    if (p.price > 0 && p.price <= newCost) out.push({ ...base, kind: 'loss', suggested: suggested || nicePrice(newCost * 1.2) });
    else if (change >= PRICE_CHANGE) out.push({ ...base, kind: 'up', suggested: suggested > p.price ? suggested : 0 });
    else if (change <= -PRICE_CHANGE) out.push({ ...base, kind: 'down', suggested: 0 });
  }
  const rank = { loss: 0, up: 1, down: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || Math.abs(b.change) - Math.abs(a.change));
}

/** Change a product's selling price (from the price watch). */
export async function setPrice(ctx: Ctx, product: Product, price: number) {
  assertCan(ctx.role, 'stock');
  if (!(price > 0)) throw new AppError('err.amount');
  return update(ctx, 'products', product.id, { price: Math.round(price) }, `Price of ${product.name} now ${price / 100}`);
}
