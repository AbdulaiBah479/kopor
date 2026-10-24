import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { list } from '@/db/repo';
import { createOrg, saveMember, updateOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { deleteTxn, recordSale } from '@/domain/cash';
import { closeDay, expectedMomo } from '@/domain/closing';
import { adjustStock, saveProduct } from '@/domain/stock';
import { attendanceFlags, markDay } from '@/domain/staff';
import { byPerson, watchFlags } from '@/domain/watch';
import { distanceM } from '@/lib/geo';
import { today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('fraud watch and checks', () => {
  it('mobile money check: what the books expect per network, and a shortfall is flagged', async () => {
    const cashier = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    const c: Ctx = { ...ctx, memberId: cashier.id, memberName: cashier.name, role: 'cashier' };
    await recordSale(c, { method: 'orange', amount: 50000 });
    await recordSale(c, { method: 'orange', amount: 20000 });
    await recordSale(c, { method: 'afrimoney', amount: 10000 });
    expect(expectedMomo(await book())).toEqual({ orange: 70000, afrimoney: 10000 });
    // The owner's phone shows only Le 500 arrived by Orange Money: someone showed a fake message, or reversed it.
    await closeDay(c, { openingFloat: 0, counted: 0, expected: 0, momo: { orange: { expected: 70000, counted: 50000 }, afrimoney: { expected: 10000, counted: 10000 } } });
    const flags = watchFlags(await book(), []);
    expect(flags.filter((f) => f.kind === 'momoShort')).toMatchObject([{ who: 'Sorie', amount: 20000, detail: 'orange' }]);
    expect(flags.filter((f) => f.kind === 'unconfirmed')).toHaveLength(3);   // none confirmed by Monime
  });

  it('flags deleted sales, lost stock, big discounts and sales below cost, by person', async () => {
    const p = await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 100000, cost: 80000, low_at: 0, opening: 10 });
    const s = await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Rice', qty: 1 }] });
    await deleteTxn(ctx, s.id);
    await adjustStock(ctx, p.id, -2, { note: 'damaged' });
    await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Rice', qty: 1, price: 70000 }] });   // below cost
    await recordSale(ctx, { method: 'cash', items: [{ product_id: p.id, name: 'Rice', qty: 1 }], discount: 30000 });
    const flags = watchFlags(await book(), await list('audit', ctx.orgId));
    const kinds = flags.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['deleted', 'lost', 'belowCost', 'discount']));
    expect(flags.find((f) => f.kind === 'lost')).toMatchObject({ amount: 160000, detail: '2 bag Rice' });
    expect(flags.find((f) => f.kind === 'deleted')!.amount).toBe(100000);
    expect(byPerson(flags)[0].who).toBe('Ama');
  });

  it('attendance: tapping in far from the shop, or reaching the server long after the claimed time', async () => {
    await updateOrg(ctx, { shop_lat: 8.4844, shop_lng: -13.2299 });               // Freetown
    const m = await saveMember(ctx, { name: 'Fatu', phone: '077333444', role: 'cashier', branch_id: null });
    const staff: Ctx = { ...ctx, memberId: m.id, memberName: m.name, role: 'cashier' };
    await markDay(staff, m, today(), { status: 'present', time_in: '08:00', where_m: 1500 });
    let a = (await book()).attendance[0];
    expect(attendanceFlags(await book(), a)).toEqual(['away']);
    await db.attendance.update(a.id, { where_m: 20, seen_at: new Date(`${today()}T10:30:00`).toISOString() });  // server got it 2½ hours later
    a = (await book()).attendance[0];
    expect(attendanceFlags(await book(), a)).toEqual(['late']);
    expect(distanceM({ lat: 8.4844, lng: -13.2299 }, { lat: 8.4979, lng: -13.2299 })).toBeGreaterThan(1400);
  });
});
