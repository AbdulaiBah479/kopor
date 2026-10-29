import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, saveMember, updateOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordExpense, recordSale } from '@/domain/cash';
import { cashSinceLastCount, closeDay, handOver, lastClosing } from '@/domain/closing';
import { loyaltyFor } from '@/domain/loyalty';
import { moneyNow } from '@/domain/moneyNow';
import { saveProduct } from '@/domain/stock';
import { watchFlags } from '@/domain/watch';
import { addDays, today } from '@/lib/dates';

let ctx: Ctx, cashier: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
  const m = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
  cashier = { ...ctx, memberId: m.id, memberName: m.name, role: 'cashier' };
});

describe('shift handover', () => {
  it('counts from the last handover; a shortage is the outgoing cashier’s; it does not close the day', async () => {
    await recordSale(cashier, { method: 'cash', amount: 5000 });
    let x = cashSinceLastCount(await book());
    expect(x.expected).toBe(5000);
    await handOver(cashier, { counted: 4500, expected: x.expected, to: ctx.memberId! });   // Le 5 short
    await recordSale(ctx, { method: 'cash', amount: 2000 });
    x = cashSinceLastCount(await book());
    expect(x).toMatchObject({ start: 4500, sales: 2000, expected: 6500 });
    const b = await book();
    expect(lastClosing(b)).toBeUndefined();                                    // the day is not closed yet
    const short = watchFlags(b, []).find((f) => f.kind === 'short');
    expect(short).toMatchObject({ who: 'Sorie', amount: 500, detail: 'handover' });
    await expect(handOver(cashier, { counted: 1, expected: 1, to: cashier.memberId! })).rejects.toThrow('err.handoverTo');
  });
});

describe('loyalty', () => {
  it('counts visit days, not sales; only customers with a phone; reward on every Nth visit', async () => {
    await updateOrg(ctx, { loyalty_every: 3, loyalty_pct: 5 });
    await recordSale(ctx, { method: 'cash', amount: 1000, customer: 'Fatu', phone: '076 555 444', date: addDays(today(), -5) });
    // Three sales on one day are one visit (a split sale does not reach the reward sooner).
    for (let i = 0; i < 3; i++) await recordSale(ctx, { method: 'cash', amount: 1000, customer: 'Fatu', date: addDays(today(), -2) });
    expect(loyaltyFor(await book(), 'Fatu')).toMatchObject({ visits: 3, due: true, pct: 5 });   // today is visit 3
    await recordSale(ctx, { method: 'cash', amount: 1000, customer: 'Fatu' });
    expect(loyaltyFor(await book(), 'Fatu')?.due).toBe(false);                                 // already rewarded today
    await recordSale(ctx, { method: 'cash', amount: 1000, customer: 'No Phone', date: addDays(today(), -1) });
    expect(loyaltyFor(await book(), 'No Phone')).toBeNull();
  });
});

describe('money now and new warning signs', () => {
  it('shows the drawer, mobile money, credit and stock in one place', async () => {
    await saveProduct(ctx, { name: 'Oil', unit: 'tin', price: 10000, cost: 6000, low_at: 0, opening: 5 });
    await recordSale(ctx, { method: 'cash', amount: 4000 });
    await recordSale(ctx, { method: 'orange', amount: 2500 });
    await recordExpense(ctx, { amount: 500, category: 'transport' });
    await recordSale(ctx, { method: 'credit', amount: 3000, customer: 'Musa' });
    const m = moneyNow(await book());
    expect(m).toMatchObject({ drawer: 3500, owedToYou: 3000, stock: 30000 });
    expect(m.momo).toEqual([['orange', 2500]]);
  });

  it('flags a cashier whose sales skip the products (stock never goes down)', async () => {
    for (const n of ['Oil', 'Rice', 'Sugar']) await saveProduct(ctx, { name: n, unit: 'pc', price: 1000, cost: 500, low_at: 0, opening: 10 });
    for (let i = 0; i < 6; i++) await recordSale(cashier, { method: 'cash', amount: 1000 });
    const f = watchFlags(await book(), []).find((x) => x.kind === 'noItems');
    expect(f).toMatchObject({ who: 'Sorie', amount: 6000, detail: '6/6' });
  });

  it('a day with a handover but no close is still "not closed"', async () => {
    await recordSale(cashier, { method: 'cash', amount: 1000, date: addDays(today(), -1) });
    await closeDay(ctx, { openingFloat: 0, counted: 0, expected: 0, date: addDays(today(), -1) });
    await recordSale(ctx, { method: 'cash', amount: 1000, date: addDays(today(), -3) });
    expect(watchFlags(await book(), []).filter((x) => x.kind === 'noClose').map((x) => x.date)).toEqual([addDays(today(), -3)]);
  });
});

describe('supplier due dates and more warning signs', () => {
  it('goods bought on credit get a due date; Reminders lists suppliers due soon or late', async () => {
    const { recordPurchase } = await import('@/domain/stock');
    const { suppliersToPay } = await import('@/domain/expiry');
    const { addEntry } = await import('@/domain/credit');
    await recordPurchase(ctx, { supplier: 'Kroo Bay Wholesale', method: 'credit', lines: [{ productId: null, name: 'Rice', qty: 2, unitCost: 5000 }], dueDate: addDays(today(), 2) });
    let list = suppliersToPay(await book());
    expect(list).toMatchObject([{ owed: 10000, due: addDays(today(), 2), late: false }]);
    await addEntry(ctx, { contactId: list[0].contact.id, type: 'gave', amount: 10000 });   // paid
    list = suppliersToPay(await book());
    expect(list).toEqual([]);
  });

  it('flags one phone behind several customers with credit, habitual small discounts, and discounts to staff', async () => {
    const { addEntry, ensureContact } = await import('@/domain/credit');
    const a = await ensureContact(cashier, 'Musa A', '076 222 333');
    const b = await ensureContact(cashier, 'Musa B', '+232 76 222 333');
    await addEntry(cashier, { contactId: a.id, type: 'gave', amount: 3000 });
    await addEntry(cashier, { contactId: b.id, type: 'gave', amount: 4000 });
    for (let i = 0; i < 5; i++) await recordSale(cashier, { method: 'cash', amount: 1000, discount: 80 });   // 8% each, under the 10% line
    await ensureContact(ctx, 'Sorie (staff)', '077111222');
    await recordSale(ctx, { method: 'cash', amount: 2000, discount: 100, customer: 'Sorie (staff)' });
    const flags = watchFlags(await book(), []);
    expect(flags.find((f) => f.kind === 'dupPhone')).toMatchObject({ amount: 7000, detail: 'Musa A, Musa B' });
    expect(flags.find((f) => f.kind === 'habitDiscount')).toMatchObject({ who: 'Sorie', amount: 400 });
    expect(flags.find((f) => f.kind === 'staffDiscount')).toMatchObject({ who: 'Sorie', amount: 100, detail: 'Ama' });
  });
});
