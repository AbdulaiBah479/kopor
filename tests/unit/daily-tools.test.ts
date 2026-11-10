import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Product } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale } from '@/domain/cash';
import { addEntry, balances, ensureContact } from '@/domain/credit';
import { saveProduct, adjustStock, recordPurchase, stockLevels } from '@/domain/stock';
import { saveGoal } from '@/domain/savings';
import { expectedCash } from '@/domain/closing';
import { addDays, today } from '@/lib/dates';
import { cancelLayaway, collectLayaway, payLayaway, progress, startLayaway } from '@/domain/layaway';
import { jarShares } from '@/ui/Jars';
import { pendingOrders, receiveOrder, reorderList, saveOrder } from '@/domain/restock';
import { todayList } from '@/domain/todo';
import { trustOf } from '@/domain/trust';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
const product = (name: string, price: number, cost: number, low_at = 0) => saveProduct(ctx, { name, price, cost, unit: 'pcs', low_at } as never) as Promise<Product>;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Tools Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('pay small-small', () => {
  it('payments go in the drawer; when fully paid the customer takes the goods and owes nothing', async () => {
    const phone = await product('Tecno phone', 300_000, 220_000);
    await adjustStock(ctx, phone.id, 2);
    const plan = await startLayaway(ctx, { customer: 'Fatu', phone: '076 111 222', item: 'Tecno phone', productId: phone.id, total: 300_000, first: 100_000 });
    let b = await book();
    expect(progress(b, plan)).toMatchObject({ paid: 100_000, left: 200_000, done: false });
    expect(expectedCash(b).repaid).toBe(100_000);                           // shown at closing with money received
    await expect(collectLayaway(ctx, b, plan)).rejects.toThrow('lay.notPaid');
    await expect(payLayaway(ctx, plan, 250_000, 200_000)).rejects.toThrow('lay.tooMuch');
    await payLayaway(ctx, plan, 200_000, 200_000);
    b = await book();
    await collectLayaway(ctx, b, b.layaways[0]);
    b = await book();
    expect(b.layaways[0].status).toBe('collected');
    expect(stockLevels(b).get(phone.id)).toBe(1);                           // the phone left the shop
    const fatu = b.contacts.find((c) => c.name === 'Fatu')!;
    expect(balances(b.ledger).get(fatu.id) ?? 0).toBe(0);                  // owes nothing
    expect(trustOf(b.ledger, fatu.id).oldestOpenDays).toBe(0);             // paying first is not a debt
  });
  it('cancelling gives the money back', async () => {
    const plan = await startLayaway(ctx, { customer: 'Musa', item: 'Mattress', total: 50_000, first: 20_000 });
    await cancelLayaway(ctx, await book(), plan);
    const b = await book();
    expect(b.layaways[0].status).toBe('cancelled');
    expect(b.txns.some((x) => x.category === 'refund' && x.amount === 20_000)).toBe(true);
    expect(balances(b.ledger).get(b.contacts[0].id) ?? 0).toBe(0);
  });
});

describe('money jars', () => {
  it('suggests each jar’s share of today’s sales', async () => {
    await recordSale(ctx, { method: 'cash', amount: 123_400 });
    await saveGoal(ctx, { name: 'Rent', target: 1_000_000, auto_pct: 10 });
    await saveGoal(ctx, { name: 'Holiday', target: 500_000 });
    const jars = jarShares(await book());
    expect(jars.map((j) => [j.goal.name, j.amount])).toEqual([['Rent', 12_300]]);   // 10% of Le 1,234, whole Leones
  });
});

describe('restock order', () => {
  it('orders what runs low at last time’s quantity and price, and records the purchase on arrival', async () => {
    const rice = await product('Rice', 1_000, 0, 5);
    await recordPurchase(ctx, { lines: [{ productId: rice.id, name: 'Rice', qty: 20, unitCost: 700 }], supplier: 'Alie Wholesale', date: addDays(today(), -10) });
    await adjustStock(ctx, rice.id, -17);                                     // 3 left, below the alert level of 5
    const list = reorderList(await book());
    expect(list).toEqual([expect.objectContaining({ name: 'Rice', qty: 20, unitCost: 700, supplier: 'Alie Wholesale' })]);
    const o = await saveOrder(ctx.orgId, { supplier: 'Alie Wholesale', phone: '078000000', lines: list.map(({ supplier: _s, ...l }) => l) });
    expect(await pendingOrders(ctx.orgId)).toHaveLength(1);
    await receiveOrder(ctx, o, o.lines, 'cash');
    expect(stockLevels(await book()).get(rice.id)).toBe(23);
    expect(await pendingOrders(ctx.orgId)).toHaveLength(0);
  });
});

describe('today’s to-do', () => {
  it('lists debts to chase and stock to reorder, most urgent first', async () => {
    const c = await ensureContact(ctx, 'Sorie', '077 222 333');
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 5_000, date: addDays(today(), -20), dueDate: addDays(today(), -10) });
    const oil = await product('Oil', 3_000, 2_500, 2);
    await adjustStock(ctx, oil.id, 1);
    const list = todayList(await book());
    expect(list.map((i) => i.kind)).toEqual(['chase', 'reorder']);
    expect(list[0].params).toMatchObject({ name: 'Sorie', amount: 5_000, days: 10 });
  });
});
