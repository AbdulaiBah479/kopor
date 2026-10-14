import { db, type LineItem, type Method, type Txn } from '@/db/schema';
import { insert, update, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today, addDays } from '@/lib/dates';
import { AppError, findByName, type Book } from './book';
import { ensureContact, addEntry } from './credit';
import { computeTotals, taxSettings } from './tax';

export const EXPENSE_CATEGORIES = ['stock', 'rent', 'transport', 'salaries', 'utilities', 'phone', 'fuel', 'food', 'repairs', 'taxes', 'loan', 'other'] as const;
export const METHODS: Method[] = ['cash', 'orange', 'afrimoney', 'qmoney', 'bank', 'card', 'credit'];

export const itemsTotal = (items: LineItem[]) => Math.round(items.reduce((s, i) => s + i.qty * i.price, 0));
export const itemsLabel = (items: LineItem[]) => items.map((i) => `${i.qty} ${i.name}`).join(', ');

export interface SaleInput {
  items?: Partial<LineItem>[]; amount?: number; discount?: number; method: Method; customer?: string; phone?: string;
  note?: string; date?: string; dueDate?: string | null; invoiceId?: string | null;
}

/** Totals for a sale using the business's tax settings. A typed amount (no items) is what the customer paid, tax included. */
export async function saleTotals(orgId: string, items: LineItem[], amount = 0, discount = 0) {
  const org = await db.orgs.get(orgId);
  const tax = taxSettings(org ?? {});
  return items.length ? computeTotals(itemsTotal(items), discount, tax) : computeTotals(amount, discount, { ...tax, inclusive: true });
}

/** Records a sale: cash book entry, stock deduction, and a credit-book debt if sold on credit. */
export async function recordSale(ctx: Ctx, input: SaleInput): Promise<Txn> {
  assertCan(ctx.role, 'record');
  const products = (await db.products.where('org_id').equals(ctx.orgId).toArray()).filter((p) => !p.deleted);
  const items: LineItem[] = (input.items ?? [])
    .filter((i) => i.name?.trim() && (i.qty ?? 0) > 0)
    .map((i) => {
      const p = (i.product_id && products.find((x) => x.id === i.product_id)) || findByName(products, i.name!);
      return { product_id: p?.id ?? null, name: p?.name ?? i.name!.trim(), qty: i.qty!, price: Math.round(i.price ?? p?.price ?? 0), cost: p?.cost ?? 0 };
    });
  const totals = await saleTotals(ctx.orgId, items, input.amount, input.discount);
  const total = totals.total;
  if (!(total > 0)) throw new AppError('err.amountOrItems');
  const customer = input.customer?.trim() ?? '';
  if (input.method === 'credit' && !customer) throw new AppError('err.creditCustomer');
  const date = input.date || today();

  return atomic(async () => {
    const contact = customer ? await ensureContact(ctx, customer, input.phone) : null;
    let txn = await insert(ctx, 'transactions', {
      branch_id: ctx.branchId, type: 'in', category: 'sale', amount: total, method: input.method, contact_id: contact?.id ?? null,
      note: input.note?.trim() ?? '', date, items, ledger_id: null, invoice_id: input.invoiceId ?? null,
      discount: totals.discount, tax: totals.tax, refund_of: null,
    }, `Sale ${total / 100} (${input.method})`);
    for (const i of items) {
      if (!i.product_id) continue;
      await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: i.product_id, qty: -i.qty, reason: 'sale', ref_id: txn.id, date }, `Sold ${i.qty} ${i.name}`);
    }
    if (input.method === 'credit' && contact) {
      const entry = await addEntry(ctx, {
        contactId: contact.id, type: 'gave', amount: total, note: input.note?.trim() || itemsLabel(items) || 'Sale on credit',
        date, dueDate: input.dueDate ?? addDays(date, 14), refType: 'transaction', refId: txn.id,
      });
      txn = await update(ctx, 'transactions', txn.id, { ledger_id: entry.id });
    }
    return txn;
  });
}

export interface ExpenseInput { amount: number; category: string; method?: Method; note?: string; date?: string }
export async function recordExpense(ctx: Ctx, i: ExpenseInput): Promise<Txn> {
  assertCan(ctx.role, 'record');
  if (!(i.amount > 0)) throw new AppError('err.amount');
  return insert(ctx, 'transactions', {
    branch_id: ctx.branchId, type: 'out', category: i.category || 'other', amount: Math.round(i.amount), method: i.method ?? 'cash',
    contact_id: null, note: i.note?.trim() ?? '', date: i.date || today(), items: [], ledger_id: null, invoice_id: null,
    discount: 0, tax: 0, refund_of: null,
  }, `Expense ${i.amount / 100} (${i.category})`);
}

/** Undo a cash entry: stock comes back and the linked debt disappears. */
export async function deleteTxn(ctx: Ctx, id: string) {
  assertCan(ctx.role, 'edit');
  await atomic(async () => {
    const txn = await db.transactions.get(id);
    if (!txn) throw new AppError('err.notFound');
    const moves = await db.stock_moves.where('ref_id').equals(id).toArray();
    for (const m of moves) await update(ctx, 'stock_moves', m.id, { deleted: 1 });
    if (txn.ledger_id) await update(ctx, 'ledger', txn.ledger_id, { deleted: 1 });
    await update(ctx, 'transactions', id, { deleted: 1 }, `Deleted ${txn.type === 'in' ? 'sale' : 'expense'} ${txn.amount / 100}`);
  });
}

/* ---------- Reports ---------- */
/**
 * Sales are reported NET of tax (tax belongs to the government) and net of refunds.
 * `byMethod` shows the money actually received per payment method.
 */
export function summary(book: Book, from: string, to: string) {
  let sales = 0, expenses = 0, count = 0, cogs = 0, tax = 0, refunds = 0, discounts = 0;
  const byMethod: Record<string, number> = {};
  for (const t of book.txns) {
    if (t.date < from || t.date > to) continue;
    count++;
    const net = t.amount - (t.tax ?? 0);
    if (t.type === 'in') {
      sales += net;
      tax += t.tax ?? 0;
      discounts += t.discount ?? 0;
      byMethod[t.method] = (byMethod[t.method] ?? 0) + t.amount;
      for (const i of t.items) cogs += i.cost * i.qty;
    } else if (t.category === 'refund') {
      sales -= net;
      refunds += t.amount;
      tax -= t.tax ?? 0;
      byMethod[t.method] = (byMethod[t.method] ?? 0) - t.amount;
      for (const i of t.items) cogs -= i.cost * i.qty;
    } else expenses += t.amount;
  }
  return { sales, expenses, profit: sales - expenses, count, cogs: Math.round(cogs), byMethod, tax, refunds, discounts };
}

export function dailySeries(book: Book, days: number, end = today()) {
  return Array.from({ length: days }, (_, k) => {
    const d = addDays(end, k - days + 1);
    const s = summary(book, d, d);
    return { date: d, sales: s.sales, expenses: s.expenses };
  });
}

export function topProducts(book: Book, from: string, to: string, n = 5) {
  const m = new Map<string, { name: string; qty: number; amount: number }>();
  for (const t of book.txns) {
    if (t.type !== 'in' || t.date < from || t.date > to) continue;
    for (const i of t.items) {
      const r = m.get(i.name) ?? { name: i.name, qty: 0, amount: 0 };
      r.qty += i.qty; r.amount += i.qty * i.price;
      m.set(i.name, r);
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}
