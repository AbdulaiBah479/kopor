import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Product } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale } from '@/domain/cash';
import { saveProduct, adjustStock, stockLevels } from '@/domain/stock';
import { addDays, today } from '@/lib/dates';
import { billsOf, cashPlan, dueOnOrAfter, duesOf, payBill, saveBill, type Bill } from '@/domain/bills';
import { countLines, countTotals, saveCount } from '@/domain/stockCount';

const bill = (b: Partial<Bill>): Bill => ({ id: 'b', name: 'Rent', amount: 100_000, category: 'rent', every: 'month', day: 1, start: '2026-01-01', paid: null, ...b });

describe('bill due dates', () => {
  it('monthly bills fall on their day, or the last day of short months', () => {
    expect(dueOnOrAfter(bill({ day: 5 }), '2026-11-03')).toBe('2026-11-05');
    expect(dueOnOrAfter(bill({ day: 5 }), '2026-11-06')).toBe('2026-12-05');
    expect(dueOnOrAfter(bill({ day: 31 }), '2026-02-10')).toBe('2026-02-28');
  });
  it('weekly bills fall on their weekday (2026-11-10 is a Tuesday)', () => {
    expect(dueOnOrAfter(bill({ every: 'week', day: 4 }), '2026-11-10')).toBe('2026-11-13'); // Friday
    expect(dueOnOrAfter(bill({ every: 'week', day: 1 }), '2026-11-10')).toBe('2026-11-10'); // Tuesday itself
  });
  it('unpaid months stay due (and late); paying moves the bill on', () => {
    const b = bill({ day: 1, start: '2026-09-15' });
    expect(duesOf(b, '2026-11-30', '2026-11-10').map((d) => [d.due, d.late])).toEqual([['2026-10-01', true], ['2026-11-01', true]]);
    expect(duesOf({ ...b, paid: '2026-11-01' }, '2026-12-31', '2026-11-10').map((d) => d.due)).toEqual(['2026-12-01']);
    expect(duesOf(bill({ every: 'once', date: '2026-11-20' }), '2026-12-31', '2026-11-10')).toHaveLength(1);
  });
});

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Plan Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('cash plan', () => {
  it('warns when the money in the drawer does not cover this week’s bills, and paying records an expense', async () => {
    await recordSale(ctx, { method: 'cash', amount: 50_000 });
    const due = addDays(today(), 2);
    await saveBill(ctx, (await book()).org, { name: 'School fees', amount: 80_000, category: 'other', every: 'once', day: 1, date: due });
    let plan = cashPlan(await book());
    expect(plan.have).toBe(50_000);
    expect(plan.dueWeek).toBe(80_000);
    expect(plan.shortWeek).toBe(30_000);
    const b = await book();
    await payBill(ctx, b.org, plan.dues[0]);
    plan = cashPlan(await book());
    expect(plan.dues).toHaveLength(0);
    expect(billsOf((await book()).org)[0].paid).toBe(due);
    expect((await book()).txns.some((x) => x.type === 'out' && x.note === 'School fees' && x.amount === 80_000)).toBe(true);
  });
});

describe('stock count', () => {
  it('shows what is missing and what it is worth, then corrects the stock', async () => {
    const rice = await saveProduct(ctx, { name: 'Rice', price: 1_000, cost: 700, unit: 'cup', low_at: 0 } as never) as Product;
    const oil = await saveProduct(ctx, { name: 'Oil', price: 3_000, cost: 2_500, unit: 'tin', low_at: 0 } as never) as Product;
    await adjustStock(ctx, rice.id, 20); await adjustStock(ctx, oil.id, 5);
    const b = await book();
    const lines = countLines(b.products, stockLevels(b), { [rice.id]: 17, [oil.id]: 5 });
    expect(countTotals(lines)).toMatchObject({ checked: 2, missingItems: 1, missingValue: 2_100, extraItems: 0 });
    await saveCount(ctx, lines);
    const after = stockLevels(await book());
    expect(after.get(rice.id)).toBe(17);
    expect(after.get(oil.id)).toBe(5);
  });
});
