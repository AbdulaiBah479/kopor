import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { PermissionError } from '@/db/permissions';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale, recordExpense, deleteTxn, summary } from '@/domain/cash';
import { saveProduct, adjustStock, stockLevels, forecast } from '@/domain/stock';
import { balances, overdueSince, ensureContact, addEntry, creditTotals } from '@/domain/credit';
import { createInvoice, markInvoicePaid } from '@/domain/invoices';
import { saveGroup, currentRound, collectorFor, roundStatus, toggleContribution, parseMembers } from '@/domain/groups';
import { health } from '@/domain/health';
import { insights } from '@/domain/insights';
import { createDemo } from '@/domain/demo';
import { exportOrg, importOrg } from '@/domain/backup';
import { today, addDays } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('cash & stock', () => {
  it('records a sale, reduces stock, and reverses cleanly', async () => {
    const p = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 85000, cost: 72000, low_at: 2, opening: 10 });
    const sale = await recordSale(ctx, { items: [{ name: 'rice', qty: 3 }], method: 'orange' });
    expect(sale.amount).toBe(255000);
    expect(sale.items[0].product_id).toBe(p.id);
    expect(stockLevels(await book()).get(p.id)).toBe(7);
    await deleteTxn(ctx, sale.id);
    expect(stockLevels(await book()).get(p.id)).toBe(10);
    expect(summary(await book(), today(), today()).sales).toBe(0);
  });

  it('credit sale creates a debt in the credit book', async () => {
    const sale = await recordSale(ctx, { amount: 50000, method: 'credit', customer: 'Fatu' });
    const b = await book();
    const fatu = b.contacts.find((c) => c.name === 'Fatu')!;
    expect(balances(b.ledger).get(fatu.id)).toBe(50000);
    expect(sale.ledger_id).toBeTruthy();
    await deleteTxn(ctx, sale.id);
    expect(balances((await book()).ledger).get(fatu.id) ?? 0).toBe(0);
  });

  it('rejects empty sales and credit sales without a customer', async () => {
    await expect(recordSale(ctx, { amount: 0, method: 'cash' })).rejects.toThrow('err.amountOrItems');
    await expect(recordSale(ctx, { amount: 100, method: 'credit' })).rejects.toThrow('err.creditCustomer');
  });

  it('restock records an expense and forecasts days left', async () => {
    const p = await saveProduct(ctx, { name: 'Soap', unit: 'pcs', price: 1200, cost: 800, low_at: 5, opening: 20 });
    await adjustStock(ctx, p.id, 10, { recordExpense: true });
    for (let d = 0; d < 14; d++) await recordSale(ctx, { items: [{ name: 'Soap', qty: 1 }], method: 'cash', date: addDays(today(), -d) });
    const b = await book();
    expect(stockLevels(b).get(p.id)).toBe(16);
    expect(summary(b, today(), today()).expenses).toBe(8000);
    expect(forecast(b, p.id).daysLeft).toBe(16);
  });
});

describe('credit book', () => {
  it('applies payments to the oldest debt first when checking overdue', async () => {
    const c = await ensureContact(ctx, 'Musa');
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 1000, date: addDays(today(), -30), dueDate: addDays(today(), -20) });
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 500, date: addDays(today(), -5), dueDate: addDays(today(), 5) });
    let b = await book();
    expect(overdueSince(b.ledger, c.id)).toBe(addDays(today(), -20));
    await addEntry(ctx, { contactId: c.id, type: 'got', amount: 1000 });
    b = await book();
    expect(overdueSince(b.ledger, c.id)).toBeNull();
    expect(creditTotals(b).get).toBe(500);
  });

  it('does not duplicate contacts with different capitalisation', async () => {
    const a = await ensureContact(ctx, 'Aminata Sesay');
    const b = await ensureContact(ctx, '  aminata sesay ', '076111111');
    expect(b.id).toBe(a.id);
    expect(b.phone).toBe('076111111');
  });
});

describe('invoices', () => {
  it('unpaid invoice goes to the credit book and is settled when paid', async () => {
    const inv = await createInvoice(ctx, { customer: 'Hotel', items: [{ name: 'Water', qty: 4, price: 2500 }], paid: false, dueDate: addDays(today(), 7) });
    expect(inv.number).toBe('INV-0001');
    expect(inv.public_token.length).toBeGreaterThanOrEqual(16);
    let b = await book();
    expect(balances(b.ledger).get(inv.contact_id!)).toBe(10000);
    await markInvoicePaid(ctx, inv.id);
    b = await book();
    expect(balances(b.ledger).get(inv.contact_id!)).toBe(0);
    expect(b.invoices[0].status).toBe('paid');
    const second = await createInvoice(ctx, { customer: 'Hotel', items: [{ name: 'Water', qty: 1, price: 2500 }], paid: true });
    expect(second.number).toBe('INV-0002');
  });
});

describe('osusu', () => {
  it('rotates the collector and tracks contributions', async () => {
    const members = parseMembers('Ada, 076\nBen\nCee');
    const g = await saveGroup(ctx, { name: 'Market Osusu', kind: 'osusu', amount: 20000, frequency: 'weekly', start_date: addDays(today(), -8), members });
    expect(currentRound(g)).toBe(2);
    expect(collectorFor(g, 2)!.name).toBe('Ben');
    await toggleContribution(ctx, g, members[0].id, 2);
    let s = roundStatus(await book(), g, 2);
    expect(s.collected).toBe(20000);
    expect(s.unpaid.map((m) => m.name)).toEqual(['Ben', 'Cee']);
    await toggleContribution(ctx, g, members[0].id, 2);
    s = roundStatus(await book(), g, 2);
    expect(s.collected).toBe(0);
  });
});

describe('permissions', () => {
  it('viewers cannot record; cashiers can undo only their own recent entries and cannot manage stock', async () => {
    await expect(recordExpense({ ...ctx, role: 'viewer' }, { amount: 100, category: 'food' })).rejects.toBeInstanceOf(PermissionError);
    const cashier: Ctx = { ...ctx, role: 'cashier', memberId: 'cashier-member' };
    const own = await recordExpense(cashier, { amount: 100, category: 'food' });
    await deleteTxn(cashier, own.id); // own entry, just created: allowed (undo)
    const ownersEntry = await recordExpense(ctx, { amount: 100, category: 'food' });
    await expect(deleteTxn(cashier, ownersEntry.id)).rejects.toBeInstanceOf(PermissionError);
    await expect(saveProduct({ ...ctx, role: 'cashier' }, { name: 'X', unit: 'pcs', price: 1, cost: 0, low_at: 0 })).rejects.toBeInstanceOf(PermissionError);
  });

  it('writes an audit entry for every change', async () => {
    await recordExpense(ctx, { amount: 100, category: 'food' });
    const audit = await db.audit.where('org_id').equals(ctx.orgId).toArray();
    expect(audit.some((a) => a.entity === 'transactions' && a.member_name === 'Ama')).toBe(true);
  });
});

describe('reports, demo and backup', () => {
  it('demo business produces a sensible health score and insights', async () => {
    const orgId = await createDemo();
    const b = (await loadBook(orgId))!;
    const h = health(b);
    expect(h.score).toBeGreaterThan(30);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(b.products.length).toBe(8);
    expect(insights(b).length).toBeGreaterThan(0);
    const s = summary(b, addDays(today(), -29), today());
    expect(s.profit / s.sales).toBeLessThan(0.6);
  });

  it('encrypted backup round-trips and rejects a wrong password', async () => {
    await recordSale(ctx, { amount: 12345, method: 'cash' });
    const text = await exportOrg(ctx.orgId, 'secret-pass');
    expect(text).not.toContain('12345');
    await expect(importOrg(text, 'wrong')).rejects.toThrow('err.backupPassword');
    await db.delete(); await db.open();
    const orgId = await importOrg(text, 'secret-pass');
    const b = (await loadBook(orgId))!;
    expect(summary(b, today(), today()).sales).toBe(12345);
  });
});
