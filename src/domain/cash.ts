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

/** "Milk tin (carton of 24)": the name of a carton line. */
export const packLabel = (p: { name: string; pack_size?: number | null; pack_name?: string | null }) => `${p.name} (${p.pack_name || 'carton'} of ${p.pack_size})`;

/** Records a sale: cash book entry, stock deduction, and a credit-book debt if sold on credit. */
export async function recordSale(ctx: Ctx, input: SaleInput): Promise<Txn> {
  assertCan(ctx.role, 'record');
  const products = (await db.products.where('org_id').equals(ctx.orgId).toArray()).filter((p) => !p.deleted);
  const items: LineItem[] = [];
  for (const i of input.items ?? []) {
    if (!i.name?.trim() || !((i.qty ?? 0) > 0)) continue;
    const p = (i.product_id && products.find((x) => x.id === i.product_id)) || findByName(products, i.name);
    // A carton line: "Milk tin (carton of 24)" at the carton price; stock goes down by 24 per carton sold.
    const per = p && p.pack_size && i.per === p.pack_size ? p.pack_size : 1;
    const name = p ? (per > 1 ? packLabel(p) : p.name) : i.name.trim();
    const line: LineItem = { product_id: p?.id ?? null, name, qty: i.qty!, price: Math.round(i.price ?? (per > 1 ? p?.pack_price ?? 0 : p?.price ?? 0)), cost: (p?.cost ?? 0) * per, ...(per > 1 ? { per } : {}) };
    // The same product at the same price on two lines becomes one line (clearer receipts, exact returns later).
    const same = items.find((x) => x.name === line.name && x.product_id === line.product_id && x.price === line.price && (x.per ?? 1) === per);
    if (same) same.qty += line.qty; else items.push(line);
  }
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
      await insert(ctx, 'stock_moves', { branch_id: ctx.branchId, product_id: i.product_id, qty: -i.qty * (i.per ?? 1), reason: 'sale', ref_id: txn.id, date }, `Sold ${i.qty} ${i.name}`);
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

/** Anyone may undo their OWN entry for 10 minutes after creating it (mirrored by the server rule in 0004). */
export const UNDO_WINDOW_MS = 10 * 60_000;
export const isOwnRecent = (ctx: Ctx, row: { created_by: string | null; created_at: number }) =>
  !!ctx.memberId && row.created_by === ctx.memberId && Date.now() - row.created_at < UNDO_WINDOW_MS;

/**
 * Undo a cash entry and everything it caused, so no figure is left half-changed: its stock movements, its credit-book
 * entry, returns made against it (with their stock and credit entries), and the invoice it came from (voided, with any
 * payment recorded against that invoice).
 */
export async function deleteTxn(ctx: Ctx, id: string) {
  await atomic(async () => {
    const txn = await db.transactions.get(id);
    if (!txn) throw new AppError('err.notFound');
    if (!isOwnRecent(ctx, txn)) assertCan(ctx.role, 'edit');
    const undoOne = async (t: Txn) => {
      for (const m of await db.stock_moves.where('ref_id').equals(t.id).toArray()) if (!m.deleted) await update(ctx, 'stock_moves', m.id, { deleted: 1 });
      if (t.ledger_id) await update(ctx, 'ledger', t.ledger_id, { deleted: 1 });
      for (const e of (await db.ledger.where('org_id').equals(ctx.orgId).toArray()).filter((e) => !e.deleted && e.ref_type === 'transaction' && e.ref_id === t.id)) {
        await update(ctx, 'ledger', e.id, { deleted: 1 });
      }
    };
    await undoOne(txn);
    const refunds = (await db.transactions.where('org_id').equals(ctx.orgId).toArray()).filter((t) => !t.deleted && t.refund_of === id);
    for (const r of refunds) { await undoOne(r); await update(ctx, 'transactions', r.id, { deleted: 1 }, `Deleted refund ${r.amount / 100} with its sale`); }
    if (txn.invoice_id && txn.type === 'in' && !txn.refund_of) {
      const inv = await db.invoices.get(txn.invoice_id);
      if (inv && !inv.deleted && inv.status !== 'void') {
        for (const e of (await db.ledger.where('org_id').equals(ctx.orgId).toArray()).filter((e) => !e.deleted && e.ref_type === 'invoice' && e.ref_id === inv.id)) {
          await update(ctx, 'ledger', e.id, { deleted: 1 });
        }
        await update(ctx, 'invoices', inv.id, { status: 'void' }, `Invoice ${inv.number} voided with its sale`);
      }
    }
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
