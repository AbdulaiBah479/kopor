import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordSale } from '@/domain/cash';
import { addEntry, ensureContact } from '@/domain/credit';
import { saveProduct } from '@/domain/stock';
import { matcher, searchBook } from '@/domain/search';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Mama Shop', type: 'shop', owner: 'Mama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('search everything', () => {
  it('matches every word in any order, ignoring case and accents', () => {
    const m = matcher('RICE bag');
    expect(m('Bag of rice 50kg')).toBe(true);
    expect(m('Rice')).toBe(false);
    expect(matcher('francais')('Français')).toBe(true);
  });

  it('finds customers by phone with or without spaces, products, sales by item or amount, and screens', async () => {
    const c = await ensureContact(ctx, 'Fatmata Kamara', '076 123 456');
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 5_000 } as never);
    await saveProduct(ctx, { name: 'Palm oil 1L', sku: 'PO1', unit: 'bottle', price: 2_500, cost: 2_000, low_at: 2 } as never);
    await recordSale(ctx, { amount: 150_000, method: 'cash', customer: 'Fatmata Kamara' });
    const b = await book();
    const screens = [{ title: 'Staff', sub: 'Attendance and pay', to: '/staff' }];
    expect(searchBook(b, '076123').map((h) => h.title)).toContain('Fatmata Kamara');
    expect(searchBook(b, 'palm').map((h) => h.kind)).toEqual(['product']);
    expect(searchBook(b, '1500').some((h) => h.kind === 'sale' && h.amount === 150_000)).toBe(true);
    expect(searchBook(b, 'attendance', screens).map((h) => h.to)).toEqual(['/staff']);
    expect(searchBook(b, '')).toEqual([]);
  });

  it('returns only the best few of each kind', async () => {
    for (let i = 0; i < 10; i++) await ensureContact(ctx, `Musa ${i}`, '');
    expect(searchBook(await book(), 'musa', [], 4).filter((h) => h.kind === 'contact')).toHaveLength(4);
  });
});
