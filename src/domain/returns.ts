// Returns & refunds: items go back into stock, and the customer gets money back
// (or, for credit sales, their debt is reduced instead).
import { db, type LineItem, type Method, type Txn } from '@/db/schema';
import { insert, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today } from '@/lib/dates';
import { AppError } from './book';
import { addEntry } from './credit';
import { itemsTotal } from './cash';

/** Quantity of each line of a sale that has already been returned. */
export async function returnedQty(saleId: string): Promise<number[]> {
  const sale = await db.transactions.get(saleId);
  if (!sale) return [];
  const refunds = (await db.transactions.where('org_id').equals(sale.org_id).toArray()).filter((t) => !t.deleted && t.refund_of === saleId);
  return sale.items.map((it) => refunds.reduce((s, r) => s + r.items.filter((x) => x.name === it.name).reduce((a, x) => a + x.qty, 0), 0));
}

export interface ReturnLine { index: number; qty: number }

export async function recordReturn(ctx: Ctx, saleId: string, lines: ReturnLine[], opts: { method?: Method; note?: string } = {}): Promise<Txn> {
  assertCan(ctx.role, 'returns');
  return atomic(async () => {
    const sale = await db.transactions.get(saleId);
    if (!sale || sale.deleted || sale.type !== 'in') throw new AppError('err.notFound');
    const done = await returnedQty(saleId);
    const items: LineItem[] = [];
    for (const l of lines) {
      const it = sale.items[l.index];
      if (!it || !(l.qty > 0)) continue;
      if (l.qty > it.qty - (done[l.index] ?? 0) + 1e-9) throw new AppError('errx.returnTooMany', { name: it.name });
      items.push({ ...it, qty: l.qty });
    }
    if (!items.length) throw new AppError('err.qty');

    // Refund the same share of discount and tax as the original sale.
    const subtotal = itemsTotal(sale.items) || sale.amount;
    const share = itemsTotal(items) / subtotal;
    const amount = Math.round(sale.amount * share);
    const tax = Math.round((sale.tax ?? 0) * share);
    const onCredit = sale.method === 'credit';
    const method: Method = onCredit ? 'credit' : opts.method ?? sale.method;
    const date = today();

    const refund = await insert(ctx, 'transactions', {
      branch_id: ctx.branchId, type: 'out', category: 'refund', amount, method, contact_id: sale.contact_id,
      note: opts.note?.trim() || items.map((i) => `${i.qty} ${i.name}`).join(', '), date, items, ledger_id: null, invoice_id: sale.invoice_id,
      discount: 0, tax, refund_of: sale.id,
    }, `Refund ${amount / 100}`);
    for (const i of items) {
      if (i.product_id) await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: i.product_id, qty: i.qty * (i.per ?? 1), reason: 'return', ref_id: refund.id, date }, `Returned ${i.qty} ${i.name}`);
    }
    if (onCredit && sale.contact_id) {
      await addEntry(ctx, { contactId: sale.contact_id, type: 'got', amount, note: `Return: ${refund.note}`, refType: 'transaction', refId: refund.id });
    }
    return refund;
  });
}
