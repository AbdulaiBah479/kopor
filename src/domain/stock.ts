import { db, type Product } from '@/db/schema';
import { insert, update, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today, addDays } from '@/lib/dates';
import { AppError, findByName, type Book } from './book';
import { recordExpense } from './cash';

/** Stock on hand per product = sum of all movements (append-only, so offline devices never conflict). */
export function stockLevels(book: Book): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of book.moves) m.set(mv.product_id, round3((m.get(mv.product_id) ?? 0) + mv.qty));
  return m;
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const isLow = (p: Product, qty: number) => qty <= p.low_at;
export const lowStock = (book: Book) => { const lv = stockLevels(book); return book.products.filter((p) => isLow(p, lv.get(p.id) ?? 0)); };
export const stockValue = (book: Book) => { const lv = stockLevels(book); return book.products.reduce((s, p) => s + Math.max(0, lv.get(p.id) ?? 0) * (p.cost || p.price), 0); };

/** Average units sold per day over the last `window` days and days of stock left at that rate. */
export function forecast(book: Book, productId: string, window = 14, now = today()) {
  const from = addDays(now, -window + 1);
  const sold = -book.moves.filter((m) => m.product_id === productId && m.reason === 'sale' && m.date >= from && m.date <= now).reduce((s, m) => s + m.qty, 0);
  const perDay = sold / window;
  const qty = stockLevels(book).get(productId) ?? 0;
  return { perDay, daysLeft: perDay > 0 ? Math.max(0, Math.floor(qty / perDay)) : null };
}

export interface ProductInput { name: string; sku?: string; unit: string; price: number; cost: number; low_at: number; opening?: number }

export async function saveProduct(ctx: Ctx, input: ProductInput, id?: string): Promise<Product> {
  assertCan(ctx.role, 'stock');
  const name = input.name.trim();
  if (!name) throw new AppError('err.nameRequired');
  const all = (await db.products.where('org_id').equals(ctx.orgId).toArray()).filter((p) => !p.deleted);
  const clash = findByName(all, name);
  if (clash && clash.id !== id) throw new AppError('err.productExists');
  const data = { name, sku: input.sku?.trim() ?? '', unit: input.unit, price: Math.round(input.price), cost: Math.round(input.cost), low_at: input.low_at };
  return atomic(async () => {
    if (id) return update(ctx, 'products', id, data, `Edited product ${name}`);
    const p = await insert(ctx, 'products', data, `New product ${name}`);
    if (input.opening) await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: p.id, qty: input.opening, reason: 'opening', ref_id: null, date: today() }, `Opening stock ${input.opening} ${name}`);
    return p;
  });
}

/** Positive qty = restock, negative = correction (damaged, lost, counted). */
export async function adjustStock(ctx: Ctx, productId: string, qty: number, opts: { recordExpense?: boolean; unitCost?: number; note?: string } = {}) {
  assertCan(ctx.role, 'stock');
  if (!qty) throw new AppError('err.qty');
  const p = await db.products.get(productId);
  if (!p) throw new AppError('err.notFound');
  return atomic(async () => {
    await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: productId, qty, reason: qty > 0 ? 'restock' : 'adjust', ref_id: null, date: today() }, `${qty > 0 ? 'Restock' : 'Adjust'} ${qty} ${p.name}`);
    const unit = opts.unitCost ?? p.cost;
    if (qty > 0 && opts.recordExpense && unit > 0) {
      await recordExpense(ctx, { amount: qty * unit, category: 'stock', note: `${qty} ${p.unit} ${p.name}`, method: 'cash' });
    }
  });
}
