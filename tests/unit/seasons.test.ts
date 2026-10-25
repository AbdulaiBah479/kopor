import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale } from '@/domain/cash';
import { adjustStock, saveProduct } from '@/domain/stock';
import { eventsOf, seasonPlan, upcoming } from '@/domain/seasons';
import { addDays } from '@/lib/dates';

let ctx: Ctx;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('season-smart restocking', () => {
  it('knows the big dates (Easter, school, Eid moving with the moon)', () => {
    const y26 = Object.fromEntries(eventsOf(2026).map((e) => [e.key, e.date]));
    expect(y26).toMatchObject({ easter: '2026-04-05', eidFitr: '2026-03-20', eidAdha: '2026-05-27', school: '2026-09-14', christmas: '2026-12-25' });
    expect(eventsOf(2027).find((e) => e.key === 'easter')!.date).toBe('2027-03-28');
    expect(upcoming('2026-05-15').map((e) => e.key)).toEqual(['eidAdha']);
    expect(upcoming('2026-12-20').map((e) => e.key)).toEqual(['christmas', 'newyear']);
  });

  it('tells what sold more before Eid last year and how many to buy now', async () => {
    const rice = await saveProduct(ctx, { name: 'Rice 50kg', unit: 'bag', price: 85000, cost: 72000, low_at: 0, opening: 500 });
    const soap = await saveProduct(ctx, { name: 'Soap', unit: 'bar', price: 500, cost: 300, low_at: 0, opening: 500 });
    const sell = async (date: string, product: typeof rice, qty: number) => recordSale(ctx, { method: 'cash', date, items: [{ product_id: product.id, name: product.name, qty }] });
    // Last year (Eid al-Adha 2025-06-06): usual 5 bags a week; 15 a week in the two weeks before Eid. Soap: no change.
    for (let w = 10; w >= 3; w--) { await sell(addDays('2025-06-06', -7 * w), rice, 5); await sell(addDays('2025-06-06', -7 * w), soap, 10); }
    for (const d of [-13, -10, -7, -4, -2, -1]) await sell(addDays('2025-06-06', d), rice, 5);
    for (const d of [-12, -5]) await sell(addDays('2025-06-06', d), soap, 10);
    // This year: about 6 bags a week lately, and 12 left on the shelf.
    for (const d of [-25, -18, -11, -4]) await sell(addDays('2026-05-15', d), rice, 6);
    const b = (await loadBook(ctx.orgId))!;
    await adjustStock(ctx, rice.id, 12 - ((await import('@/domain/stock')).stockLevels(b).get(rice.id) ?? 0));
    const plan = seasonPlan((await loadBook(ctx.orgId))!, '2026-05-15');
    expect(plan).toHaveLength(1);                                   // soap did not sell more: no tip
    expect(plan[0]).toMatchObject({ event: { key: 'eidAdha' }, days: 12, product: { name: 'Rice 50kg' }, times: 3, have: 12 });
    expect(plan[0].need).toBe(Math.ceil((24 / 28) * 12 * 3));      // 31 bags until Eid
    expect(plan[0].buy).toBe(plan[0].need - 12);
  });

  it('says nothing without last year’s records', async () => {
    const p = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 1, cost: 1, low_at: 0, opening: 50 });
    await recordSale(ctx, { method: 'cash', date: '2026-05-10', items: [{ product_id: p.id, name: 'Rice', qty: 5 }] });
    expect(seasonPlan((await loadBook(ctx.orgId))!, '2026-05-15')).toEqual([]);
  });
});
