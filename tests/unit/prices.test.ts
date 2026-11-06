import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordPurchase } from '@/domain/stock';
import { nicePrice, priceWatch, setPrice } from '@/domain/prices';
import { addDays, today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
const buy = (unitCost: number, sellPrice = 0, date = today()) =>
  recordPurchase(ctx, { lines: [{ productId: null, name: 'Rice', qty: 10, unitCost, sellPrice }], supplier: 'Alie Wholesale', date });
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Price Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('supplier price watch', () => {
  it('warns when the supplier raised the cost and suggests a price with the same margin', async () => {
    await buy(60_000, 80_000, addDays(today(), -10));   // Le 600 each, sold at Le 800
    await buy(69_000);                                   // now Le 690: 15% dearer
    const [f] = priceWatch(await book());
    expect(f).toMatchObject({ kind: 'up', oldCost: 60_000, newCost: 69_000, supplier: 'Alie Wholesale' });
    expect(f.change).toBeCloseTo(0.15);
    expect(f.suggested).toBe(92_000);                    // 800 × 690 / 600 = 920, the same one third on top
    await setPrice(ctx, f.product, f.suggested);
    expect((await book()).products[0].price).toBe(92_000);
  });

  it('says so when an item now sells at a loss, and stays quiet for small changes', async () => {
    await buy(60_000, 65_000, addDays(today(), -5));
    await buy(62_000);                                   // 3% dearer: not worth a warning
    expect(priceWatch(await book())).toHaveLength(0);
    await buy(70_000);                                   // dearer than the Le 650 selling price
    const [f] = priceWatch(await book());
    expect(f.kind).toBe('loss');
    expect(f.suggested).toBeGreaterThan(70_000);
  });

  it('rounds suggestions to prices people use', () => {
    expect(nicePrice(91_234)).toBe(91_500);              // Le 912.34 -> Le 915
    expect(nicePrice(4_120)).toBe(4_200);                // Le 41.20 -> Le 42
  });
});
