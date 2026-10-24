import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale, summary } from '@/domain/cash';
import { recordReturn } from '@/domain/returns';
import { adjustStock, recordPurchase, saveProduct, stockLevels } from '@/domain/stock';
import { batchesLeft, expiring, supplierDebts } from '@/domain/expiry';
import { addDays, today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('cartons, expiry dates and suppliers', () => {
  it('sells by the carton: stock goes down by the pieces in it, returns put them back', async () => {
    const p = await saveProduct(ctx, { name: 'Milk tin', unit: 'tin', price: 1200, cost: 900, low_at: 0, opening: 100, pack_size: 24, pack_price: 26000 });
    expect(p).toMatchObject({ pack_size: 24, pack_price: 26000, pack_name: 'carton' });
    const sale = await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Milk tin', qty: 2, per: 24 }, { product_id: p.id, name: 'Milk tin', qty: 3 }] });
    expect(sale.items).toEqual([
      { product_id: p.id, name: 'Milk tin (carton of 24)', qty: 2, price: 26000, cost: 900 * 24, per: 24 },
      { product_id: p.id, name: 'Milk tin', qty: 3, price: 1200, cost: 900 },
    ]);
    expect(sale.amount).toBe(2 * 26000 + 3 * 1200);
    expect(stockLevels(await book()).get(p.id)).toBe(100 - 48 - 3);
    await recordReturn(ctx, sale.id, [{ index: 0, qty: 1 }]);
    expect(stockLevels(await book()).get(p.id)).toBe(100 - 24 - 3);
  });

  it('a carton size that does not match the product is sold as pieces', async () => {
    const p = await saveProduct(ctx, { name: 'Soap', unit: 'bar', price: 500, cost: 300, low_at: 0, opening: 50, pack_size: 12 });
    expect(p.pack_price).toBe(6000);                                   // default carton price: 12 × piece price
    const sale = await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Soap', qty: 1, per: 99 }] });
    expect(sale.items[0]).toMatchObject({ name: 'Soap', price: 500 });
    expect(stockLevels(await book()).get(p.id)).toBe(49);
  });

  it('expiry: what is left on the shelf is the stock that expires last; soon-to-expire stock is listed', async () => {
    const now = today();
    const p = await saveProduct(ctx, { name: 'Paracetamol', unit: 'pack', price: 500, cost: 300, low_at: 0, opening: 10, expiry: addDays(now, 10) });
    await adjustStock(ctx, p.id, 20, { expiry: addDays(now, 200) });
    await adjustStock(ctx, p.id, 5);                                   // no date given
    expect(batchesLeft(await book(), p.id)).toEqual([{ expiry: addDays(now, 10), qty: 10 }, { expiry: addDays(now, 200), qty: 20 }]);
    expect(expiring(await book()).map((x) => [x.product.name, x.qty, x.expired])).toEqual([['Paracetamol', 10, false]]);
    await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Paracetamol', qty: 12 }] });  // the earliest 10 + 2 more sold
    expect(batchesLeft(await book(), p.id)).toEqual([{ expiry: addDays(now, 200), qty: 18 }]);
    expect(expiring(await book())).toEqual([]);
  });

  it('expired stock is flagged', async () => {
    const p = await saveProduct(ctx, { name: 'Yoghurt', unit: 'cup', price: 300, cost: 200, low_at: 0, opening: 6, expiry: addDays(today(), -2) });
    expect(expiring(await book())).toMatchObject([{ product: { id: p.id }, qty: 6, expired: true }]);
  });

  it('buying on credit: stock goes up, no cash expense, and the supplier is owed', async () => {
    await recordPurchase(ctx, { supplier: 'Kissy Wholesale', method: 'credit', lines: [{ productId: null, name: 'Rice 50kg', qty: 4, unitCost: 72000, sellPrice: 85000 }] });
    const b = await book();
    expect(stockLevels(b).get(b.products.find((p) => p.name === 'Rice 50kg')!.id)).toBe(4);
    expect(summary(b, today(), today()).expenses).toBe(0);
    expect(supplierDebts(b)).toMatchObject([{ contact: { name: 'Kissy Wholesale', kind: 'supplier' }, owed: 288000 }]);
    await expect(recordPurchase(ctx, { method: 'credit', lines: [{ productId: null, name: 'Sugar', qty: 1, unitCost: 100 }] })).rejects.toThrow();
  });
});
