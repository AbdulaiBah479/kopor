import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { summary } from '@/domain/cash';
import { saveProduct, stockLevels } from '@/domain/stock';
import { balances, statementToken } from '@/domain/credit';
import { createQuote, acceptQuote, voidInvoice, invoiceTotal, docKind } from '@/domain/invoices';
import { today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('quotations', () => {
  it('records nothing until accepted, then becomes a normal invoice with its own number', async () => {
    const rice = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 85000, cost: 72000, low_at: 2, opening: 10 });
    const q = await createQuote(ctx, { customer: 'Hotel', items: [{ name: 'rice', qty: 2 }], discount: 10000 });
    expect(q.number).toBe('QUO-0001');
    expect(q.status).toBe('quote');
    expect(invoiceTotal(q)).toBe(160000);
    expect(docKind(q)).toBe('quote.title');
    let b = await book();
    expect(stockLevels(b).get(rice.id)).toBe(10);           // no stock moved
    expect(summary(b, today(), today()).sales).toBe(0);     // no sale
    expect(b.ledger.length).toBe(0);                        // no debt

    const inv = await acceptQuote(ctx, q.id, { paid: false, dueDate: today() });
    expect(inv.number).toBe('INV-0001');                    // invoice numbers are not affected by quotation numbers
    expect(invoiceTotal(inv)).toBe(160000);
    b = await book();
    expect(stockLevels(b).get(rice.id)).toBe(8);
    expect([...balances(b.ledger).values()][0]).toBe(160000);
    expect(b.invoices.find((i) => i.id === q.id)!.status).toBe('accepted');
    await expect(acceptQuote(ctx, q.id, { paid: true })).rejects.toThrow();   // cannot be used twice
  });

  it('can be cancelled without touching the books, and needs items', async () => {
    const q = await createQuote(ctx, { customer: 'Hotel', items: [{ name: 'Paint', qty: 3, price: 5000 }] });
    await voidInvoice(ctx, q.id);
    expect((await book()).invoices[0].status).toBe('void');
    await expect(createQuote(ctx, { customer: 'Hotel', items: [] })).rejects.toThrow();
  });

  it('cashiers can make and accept quotations but not cancel them', async () => {
    const cashier = { ...ctx, role: 'cashier' as const };
    const q = await createQuote(cashier, { customer: 'Hotel', items: [{ name: 'Paint', qty: 1, price: 5000 }] });
    await expect(voidInvoice(cashier, q.id)).rejects.toThrow();
    await acceptQuote(cashier, q.id, { paid: true, method: 'cash' });
    expect(summary(await book(), today(), today()).sales).toBe(5000);
  });
});

describe('statement links', () => {
  it('makes one secret token per customer and renews it on request', async () => {
    const c = (await book()).contacts[0] ?? (await import('@/domain/credit').then((m) => m.ensureContact(ctx, 'Aminata', '076111111')));
    const t1 = await statementToken(ctx, c.id);
    expect(t1.length).toBeGreaterThanOrEqual(16);
    expect(await statementToken(ctx, c.id)).toBe(t1);       // same link every time
    const t2 = await statementToken(ctx, c.id, true);
    expect(t2).not.toBe(t1);                                // new link replaces the old one
    expect((await db.contacts.get(c.id))!.public_token).toBe(t2);
  });
});
