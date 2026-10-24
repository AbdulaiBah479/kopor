import { db, type Method, type Product } from '@/db/schema';
import { insert, update, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today, addDays } from '@/lib/dates';
import { AppError, findByName, type Book } from './book';
import { recordExpense } from './cash';
import { addEntry, ensureContact } from './credit';

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

export interface ProductInput {
  name: string; sku?: string; unit: string; price: number; cost: number; low_at: number; opening?: number; expiry?: string | null;
  pack_size?: number | null; pack_price?: number | null; pack_name?: string | null;
}

export async function saveProduct(ctx: Ctx, input: ProductInput, id?: string): Promise<Product> {
  assertCan(ctx.role, 'stock');
  const name = input.name.trim();
  if (!name) throw new AppError('err.nameRequired');
  const all = (await db.products.where('org_id').equals(ctx.orgId).toArray()).filter((p) => !p.deleted);
  const clash = findByName(all, name);
  if (clash && clash.id !== id) throw new AppError('err.productExists');
  const pack = input.pack_size && input.pack_size >= 2 ? Math.round(input.pack_size) : null;
  const data = {
    name, sku: input.sku?.trim() ?? '', unit: input.unit, price: Math.round(input.price), cost: Math.round(input.cost), low_at: input.low_at,
    pack_size: pack, pack_price: pack ? Math.round(input.pack_price || input.price * pack) : null, pack_name: pack ? (input.pack_name?.trim() || 'carton').slice(0, 20) : null,
  };
  return atomic(async () => {
    if (id) return update(ctx, 'products', id, data, `Edited product ${name}`);
    const p = await insert(ctx, 'products', data, `New product ${name}`);
    if (input.opening) await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: p.id, qty: input.opening, reason: 'opening', ref_id: null, date: today(), expiry: input.expiry || null }, `Opening stock ${input.opening} ${name}`);
    return p;
  });
}

/** Positive qty = restock, negative = correction (damaged, lost, counted). */
export async function adjustStock(ctx: Ctx, productId: string, qty: number, opts: { recordExpense?: boolean; unitCost?: number; note?: string; expiry?: string | null } = {}) {
  assertCan(ctx.role, 'stock');
  if (!qty) throw new AppError('err.qty');
  const p = await db.products.get(productId);
  if (!p) throw new AppError('err.notFound');
  return atomic(async () => {
    // A restock paid for is one expense, and its stock movement points to it: deleting the expense removes both.
    const unit = opts.unitCost ?? p.cost;
    const expense = qty > 0 && opts.recordExpense && unit > 0
      ? await recordExpense(ctx, { amount: qty * unit, category: 'stock', note: `${qty} ${p.unit} ${p.name}`, method: 'cash' })
      : null;
    await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: productId, qty, reason: qty > 0 ? 'restock' : 'adjust', ref_id: expense?.id ?? null, date: today(), expiry: qty > 0 ? opts.expiry || null : null }, `${qty > 0 ? 'Restock' : 'Adjust'} ${qty} ${p.name}`);
  });
}

export interface PurchaseLine { productId: string | null; name: string; qty: number; unitCost: number; sellPrice?: number; expiry?: string | null }
export interface PurchaseInput { lines: PurchaseLine[]; total?: number; supplier?: string; date?: string; method?: Method }

/**
 * Goods bought for the shop (e.g. from a photographed supplier receipt): each line adds stock to its product (new
 * products are created, cost prices updated to what was paid) and the whole receipt is ONE stock expense.
 */
export async function recordPurchase(ctx: Ctx, input: PurchaseInput) {
  assertCan(ctx.role, 'stock');
  const lines = input.lines.filter((l) => l.name.trim() && l.qty > 0);
  if (!lines.length) throw new AppError('err.amountOrItems');
  const date = input.date || today();
  const amount = Math.round(input.total || lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
  return atomic(async () => {
    const products = (await db.products.where('org_id').equals(ctx.orgId).toArray()).filter((p) => !p.deleted);
    const label = lines.map((l) => `${l.qty} ${l.name.trim()}`).join(', ');
    // Bought on credit: no money left the shop, so no expense; the supplier's book shows what the shop owes instead.
    const onCredit = input.method === 'credit';
    if (onCredit && !input.supplier?.trim()) throw new AppError('errx.supplierNeeded');
    const txn = amount > 0 && !onCredit
      ? await recordExpense(ctx, { amount, category: 'stock', method: input.method ?? 'cash', date, note: `${input.supplier?.trim() ? `${input.supplier.trim()}: ` : ''}${label}`.slice(0, 300) })
      : null;
    if (onCredit && amount > 0) {
      const supplier = await ensureContact(ctx, input.supplier!, '', 'supplier');
      await addEntry(ctx, { contactId: supplier.id, type: 'got', amount, note: `Goods on credit: ${label}`.slice(0, 300), date, refType: 'purchase' });
    }
    let created = 0;
    for (const l of lines) {
      let p = (l.productId && products.find((x) => x.id === l.productId)) || findByName(products, l.name);
      const cost = Math.round(l.unitCost);
      if (!p) {
        p = await insert(ctx, 'products', { name: l.name.trim(), sku: '', unit: 'pcs', price: Math.round(l.sellPrice || cost), cost, low_at: 0 }, `New product ${l.name.trim()}`);
        products.push(p); created++;
      } else if (cost > 0 && cost !== p.cost) {
        p = await update(ctx, 'products', p.id, { cost }, `Cost of ${p.name} now ${cost / 100}`);
      }
      await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: p.id, qty: l.qty, reason: 'restock', ref_id: txn?.id ?? null, date, expiry: l.expiry || null }, `Bought ${l.qty} ${p.name}`);
    }
    return { txn, created };
  });
}
