// Pay small-small (layaway): the customer pays in parts towards goods the shop keeps for them, and takes them home
// when everything is paid. Each payment is a credit-book entry ("got", ref_type 'layaway'), so it shows on the customer's
// page and at closing with the money received from customers. Collecting records the sale (stock goes out) against what was
// paid, so the customer owes nothing; cancelling gives the money back as a refund (which managers approve).
import type { Layaway } from '@/db/schema';
import { atomic, insert, update, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { addDays, today } from '@/lib/dates';
import { addEntry, ensureContact } from './credit';
import { recordSale } from './cash';
import { AppError, type Book } from './book';

export const paidOn = (book: Book, plan: Layaway) => book.ledger
  .filter((e) => !e.deleted && e.ref_type === 'layaway' && e.ref_id === plan.id)
  .reduce((s, e) => s + (e.type === 'got' ? e.amount : -e.amount), 0);

export function progress(book: Book, plan: Layaway, now = today()) {
  const paid = paidOn(book, plan), left = Math.max(0, plan.total - paid);
  return { paid, left, pct: Math.min(100, Math.round((paid / plan.total) * 100)), done: left === 0, late: !!plan.due_date && plan.due_date < now && left > 0 };
}

export const openPlans = (book: Book) => book.layaways.filter((l) => !l.deleted && l.status === 'open').sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));

export interface LayawayInput { customer: string; phone?: string; item: string; productId?: string | null; qty?: number; total: number; first?: number; dueDate?: string | null }
export async function startLayaway(ctx: Ctx, i: LayawayInput) {
  assertCan(ctx.role, 'record');
  if (!i.customer.trim()) throw new AppError('err.creditCustomer');
  if (!i.item.trim()) throw new AppError('err.nameRequired');
  if (!(i.total > 0)) throw new AppError('err.amount');
  if ((i.first ?? 0) > i.total) throw new AppError('lay.tooMuch');
  return atomic(async () => {
    const c = await ensureContact(ctx, i.customer, i.phone ?? '');
    const plan = await insert(ctx, 'layaways', {
      branch_id: ctx.branchId, contact_id: c.id, item: i.item.trim().slice(0, 120), product_id: i.productId ?? null, qty: i.qty && i.qty > 0 ? i.qty : 1,
      total: Math.round(i.total), date: today(), due_date: i.dueDate || addDays(today(), 30), status: 'open', txn_id: null,
    }, `Pay small-small: ${i.item.trim()} for ${c.name}`);
    if (i.first && i.first > 0) await payLayaway(ctx, plan, i.first);
    return plan;
  });
}

export async function payLayaway(ctx: Ctx, plan: Layaway, amount: number, left = Infinity) {
  assertCan(ctx.role, 'record');
  if (!(amount > 0)) throw new AppError('err.amount');
  if (amount > left) throw new AppError('lay.tooMuch');
  return addEntry(ctx, { contactId: plan.contact_id, type: 'got', amount: Math.round(amount), note: `Paid towards ${plan.item}`, refType: 'layaway', refId: plan.id });
}

/** Fully paid: the customer takes the goods. The sale is recorded on credit and settled by what was paid. */
export async function collectLayaway(ctx: Ctx, book: Book, plan: Layaway) {
  assertCan(ctx.role, 'record');
  if (!progress(book, plan).done) throw new AppError('lay.notPaid');
  const contact = book.contacts.find((c) => c.id === plan.contact_id);
  if (!contact) throw new AppError('err.notFound');
  return atomic(async () => {
    const product = plan.product_id ? book.products.find((p) => p.id === plan.product_id) : undefined;
    const txn = await recordSale(ctx, {
      method: 'credit', customer: contact.name, phone: contact.phone, note: `Pay small-small: ${plan.item}`, dueDate: today(),
      ...(product ? { items: [{ product_id: product.id, name: product.name, qty: plan.qty, price: plan.total / plan.qty, cost: product.cost }] } : { amount: plan.total }),
    });
    return update(ctx, 'layaways', plan.id, { status: 'collected', txn_id: txn.id }, `Collected ${plan.item}`);
  });
}

/** The customer gives up: their money is given back (a refund, so managers do it) and the plan is closed. */
export async function cancelLayaway(ctx: Ctx, book: Book, plan: Layaway) {
  assertCan(ctx.role, 'returns');
  const paid = paidOn(book, plan);
  return atomic(async () => {
    if (paid > 0) {
      await addEntry(ctx, { contactId: plan.contact_id, type: 'gave', amount: paid, note: `Money returned: ${plan.item}`, refType: 'layaway', refId: plan.id });
      await insert(ctx, 'transactions', {
        branch_id: ctx.branchId, type: 'out', category: 'refund', amount: paid, method: 'cash', contact_id: plan.contact_id,
        note: `Pay small-small cancelled: ${plan.item}`, date: today(), items: [], ledger_id: null, invoice_id: null, discount: 0, tax: 0, refund_of: null,
      }, `Refund ${paid / 100} for cancelled ${plan.item}`);
    }
    return update(ctx, 'layaways', plan.id, { status: 'cancelled' }, `Cancelled ${plan.item}`);
  });
}
