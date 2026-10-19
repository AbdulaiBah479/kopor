import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { summary } from '@/domain/cash';
import { saveProduct, stockLevels, recordPurchase } from '@/domain/stock';
import { today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('goods bought from a scanned receipt', () => {
  it('adds stock, creates new products, updates cost, and records one expense for the receipt', async () => {
    const rice = await saveProduct(ctx, { name: 'Rice 50kg', unit: 'bag', price: 85000, cost: 72000, low_at: 2, opening: 3 });
    const { created } = await recordPurchase(ctx, {
      supplier: 'Kissy Wholesale', total: 395000,
      lines: [{ productId: null, name: 'rice 50kg', qty: 5, unitCost: 70000 }, { productId: null, name: 'Sugar 1kg', qty: 10, unitCost: 4500, sellPrice: 6000 }],
    });
    expect(created).toBe(1);
    const b = await book();
    expect(stockLevels(b).get(rice.id)).toBe(8);
    expect(b.products.find((p) => p.id === rice.id)!.cost).toBe(70000);   // cost price follows what was paid
    const sugar = b.products.find((p) => p.name === 'Sugar 1kg')!;
    expect(stockLevels(b).get(sugar.id)).toBe(10);
    expect(sugar.price).toBe(6000);
    const s = summary(b, today(), today());
    expect(s.expenses).toBe(395000);                                        // one expense: the receipt total
    expect(b.txns.filter((t) => t.type === 'out').length).toBe(1);
  });

  it('needs at least one line, and only managers or owners can add stock', async () => {
    await expect(recordPurchase(ctx, { lines: [] })).rejects.toThrow();
    await expect(recordPurchase({ ...ctx, role: 'cashier' }, { lines: [{ productId: null, name: 'Soap', qty: 1, unitCost: 100 }] })).rejects.toThrow();
  });
});
