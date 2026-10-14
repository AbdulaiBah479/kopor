import { db, type Invoice, type LineItem, type Method } from '@/db/schema';
import { insert, update, atomic, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { randomToken, refCode } from '@/lib/crypto';
import { today } from '@/lib/dates';
import { AppError } from './book';
import { recordSale, itemsTotal, deleteTxn } from './cash';
import { addEntry, ensureContact } from './credit';

export async function nextInvoiceNumber(orgId: string): Promise<string> {
  const all = await db.invoices.where('org_id').equals(orgId).toArray();
  const max = all.reduce((m, i) => Math.max(m, Number(i.number.replace(/\D/g, '')) || 0), 0);
  return `INV-${String(max + 1).padStart(4, '0')}`;
}

/** What the customer pays: after discount, with tax (older invoices without totals = items total). */
export const invoiceTotal = (inv: Pick<Invoice, 'items' | 'total'>) => inv.total ?? itemsTotal(inv.items);

export const invoiceCode = (orgName: string, inv: Invoice) =>
  refCode([orgName, inv.number, inv.date, invoiceTotal(inv), inv.customer, inv.public_token].join('|'));

export interface InvoiceInput {
  customer: string; phone?: string; items: Partial<LineItem>[]; date?: string; dueDate?: string | null;
  notes?: string; paid: boolean; method?: Method; discount?: number;
}

/** Creates the invoice and its accounting: a paid sale, or a credit sale that the customer owes. */
export async function createInvoice(ctx: Ctx, input: InvoiceInput): Promise<Invoice> {
  assertCan(ctx.role, 'record');
  if (!input.customer.trim()) throw new AppError('err.nameRequired');
  return atomic(async () => {
    const date = input.date || today();
    const txn = await recordSale(ctx, {
      items: input.items, discount: input.discount, method: input.paid ? input.method ?? 'cash' : 'credit', customer: input.customer, phone: input.phone,
      date, dueDate: input.dueDate, note: 'Invoice',
    });
    const number = await nextInvoiceNumber(ctx.orgId);
    const inv = await insert(ctx, 'invoices', {
      branch_id: ctx.branchId, number, contact_id: txn.contact_id, customer: input.customer.trim(), phone: input.phone?.trim() ?? '',
      items: txn.items, date, due_date: input.dueDate || null, notes: input.notes?.trim() ?? '',
      status: input.paid ? 'paid' : 'unpaid', paid_date: input.paid ? date : null, public_token: randomToken(), txn_id: txn.id, ledger_id: txn.ledger_id,
      discount: txn.discount ?? 0, tax: txn.tax ?? 0, total: txn.amount,
    }, `Invoice ${number}`);
    await update(ctx, 'transactions', txn.id, { invoice_id: inv.id, note: number });
    if (txn.ledger_id) await update(ctx, 'ledger', txn.ledger_id, { note: `${number}`, ref_type: 'invoice', ref_id: inv.id });
    return inv;
  });
}

export async function markInvoicePaid(ctx: Ctx, id: string, paymentRef?: string) {
  assertCan(ctx.role, 'record');
  return atomic(async () => {
    const inv = await db.invoices.get(id);
    if (!inv) throw new AppError('err.notFound');
    if (inv.status !== 'unpaid') return inv;
    const contact = inv.contact_id ? await db.contacts.get(inv.contact_id) : await ensureContact(ctx, inv.customer, inv.phone);
    await addEntry(ctx, { contactId: contact!.id, type: 'got', amount: invoiceTotal(inv), note: `${inv.number} paid${paymentRef ? ' · ' + paymentRef : ''}`, refType: 'invoice', refId: inv.id });
    return update(ctx, 'invoices', id, { status: 'paid', paid_date: today(), contact_id: contact!.id }, `Invoice ${inv.number} paid`);
  });
}

/** Voiding an unpaid invoice cancels its sale: the debt is removed and the stock comes back. */
export async function voidInvoice(ctx: Ctx, id: string) {
  assertCan(ctx.role, 'edit');
  return atomic(async () => {
    const inv = await db.invoices.get(id);
    if (!inv) throw new AppError('err.notFound');
    if (inv.status !== 'unpaid') throw new AppError('errx.voidPaid');
    if (inv.txn_id) await deleteTxn(ctx, inv.txn_id);
    return update(ctx, 'invoices', id, { status: 'void' }, `Invoice ${inv.number} voided`);
  });
}
