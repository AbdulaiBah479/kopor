import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, updateOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordExpense, recordSale } from '@/domain/cash';
import { recordReturn } from '@/domain/returns';
import { saveProduct } from '@/domain/stock';
import { gstMonth } from '@/domain/gst';
import { today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
const month = today().slice(0, 7);
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('monthly GST summary (NRA)', () => {
  it('output tax from sales, less returns; untaxed sales listed apart; input tax only when estimated', async () => {
    await recordSale(ctx, { method: 'cash', amount: 50000 });                          // before GST was switched on
    await updateOrg(ctx, { tax_rate: 15, tax_inclusive: 0, tax_id: '1234567' });
    const p = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 100000, cost: 80000, low_at: 0, opening: 10 });
    const sale = await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Rice', qty: 2 }] }); // 2000 + 15% = 2300
    expect(sale.tax).toBe(30000);
    await recordReturn(ctx, sale.id, [{ index: 0, qty: 1 }]);
    await recordExpense(ctx, { amount: 115000, category: 'stock' });
    await recordExpense(ctx, { amount: 90000, category: 'salaries' });                 // no GST on salaries

    let g = gstMonth(await book(), month);
    expect(g).toMatchObject({ rate: 15, tin: '1234567', taxableSales: 100000, outputTax: 15000, otherSales: 50000, inputTax: 0, net: 15000 });
    g = gstMonth(await book(), month, { estimateInput: true });
    expect(g.purchasesTotal).toBe(115000);
    expect(g.inputTax).toBe(15000);                                                       // 1150 includes 150 GST
    expect(g.net).toBe(0);
  });
});
