// Deleting or undoing a record must never leave numbers half-changed (stock, debts, invoices, refunds).
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale, deleteTxn, summary } from '@/domain/cash';
import { saveProduct, stockLevels, adjustStock } from '@/domain/stock';
import { balances, dueSoon, ensureContact, addEntry } from '@/domain/credit';
import { createInvoice, markInvoicePaid } from '@/domain/invoices';
import { recordReturn } from '@/domain/returns';
import { today, addDays } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('deleting a sale undoes everything it caused', () => {
  it('a paid invoice: the debt and the payment both go, and the invoice is voided (no negative balance)', async () => {
    const inv = await createInvoice(ctx, { customer: 'Hotel', items: [{ name: 'Water', qty: 4, price: 2500 }], paid: false });
    await markInvoicePaid(ctx, inv.id);
    await deleteTxn(ctx, inv.txn_id!);
    const b = await book();
    expect([...balances(b.ledger).values()].every((v) => v === 0)).toBe(true);
    expect(b.invoices.find((i) => i.id === inv.id)!.status).toBe('void');
  });

  it('a sale with a return: the refund and the returned stock go too', async () => {
    const p = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 1000, cost: 800, low_at: 0, opening: 10 });
    const sale = await recordSale(ctx, { items: [{ name: 'Rice', qty: 3 }], method: 'cash' });
    await recordReturn(ctx, sale.id, [{ index: 0, qty: 1 }]);
    await deleteTxn(ctx, sale.id);
    const b = await book();
    expect(stockLevels(b).get(p.id)).toBe(10);
    expect(b.txns.length).toBe(0);
    expect(summary(b, today(), today()).sales).toBe(0);
  });

  it('a credit sale with a return: the debt and the credit-note entry both go', async () => {
    await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 1000, cost: 800, low_at: 0, opening: 10 });
    const sale = await recordSale(ctx, { items: [{ name: 'Rice', qty: 2 }], method: 'credit', customer: 'Fatu' });
    await recordReturn(ctx, sale.id, [{ index: 0, qty: 1 }]);
    await deleteTxn(ctx, sale.id);
    expect([...balances((await book()).ledger).values()].every((v) => v === 0)).toBe(true);
  });

  it('a paid restock from the Stock screen: deleting its expense removes the stock too', async () => {
    const p = await saveProduct(ctx, { name: 'Sugar', unit: 'pkt', price: 30, cost: 25, low_at: 0, opening: 5 });
    await adjustStock(ctx, p.id, 10, { recordExpense: true });
    let b = await book();
    expect(stockLevels(b).get(p.id)).toBe(15);
    await deleteTxn(ctx, b.txns[0].id);
    b = await book();
    expect(stockLevels(b).get(p.id)).toBe(5);
  });
});

describe('sales and reminders', () => {
  it('the same product on two lines becomes one line', async () => {
    await saveProduct(ctx, { name: 'Soap', unit: 'pcs', price: 12, cost: 8, low_at: 0, opening: 50 });
    const s = await recordSale(ctx, { items: [{ name: 'Soap', qty: 2 }, { name: 'soap', qty: 3 }], method: 'cash' });
    expect(s.items).toHaveLength(1);
    expect(s.items[0].qty).toBe(5);
  });

  it('due-soon reminders include a debt due on the last day of the window', async () => {
    const c = await ensureContact(ctx, 'Isatu');
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 5000, dueDate: addDays(today(), 3) });
    expect(dueSoon(await book(), 3).map((x) => x.contact.name)).toEqual(['Isatu']);
    expect(dueSoon(await book(), 2)).toHaveLength(0);
  });
});
