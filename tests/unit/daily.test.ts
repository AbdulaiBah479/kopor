import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { ensureContact, addEntry } from '@/domain/credit';
import { saveProduct } from '@/domain/stock';
import { dailyDigest, digestText, nextMorning } from '@/features/dailyReminder';
import { today, addDays } from '@/lib/dates';

let ctx: Ctx;
beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
  await i18n.changeLanguage('en');
});

describe('Android daily reminder', () => {
  it('says nothing when nothing needs attention', async () => {
    const d = dailyDigest((await loadBook(ctx.orgId))!);
    expect(d).toEqual({ overdue: 0, claims: 0, loans: 0, low: 0, expiring: 0, signs: 0, suppliers: 0 });
    expect(digestText(i18n.t, d)).toBeNull();
  });
  it('counts overdue customers and low stock, in plain words', async () => {
    for (const name of ['Isatu', 'Abu']) {
      const c = await ensureContact(ctx, name);
      await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 5000, date: addDays(today(), -20), dueDate: addDays(today(), -5) });
    }
    await saveProduct(ctx, { name: 'Rice', unit: 'bag', price: 1000, cost: 800, low_at: 5, opening: 2 });
    const d = dailyDigest((await loadBook(ctx.orgId))!);
    expect(d).toMatchObject({ overdue: 2, low: 1 });
    expect(digestText(i18n.t, d)).toBe('2 customers overdue · 1 item running low');
  });
  it('schedules for the next 8:00', () => {
    expect(nextMorning(new Date(2026, 9, 22, 6, 30)).toString()).toBe(new Date(2026, 9, 22, 8, 0).toString());
    expect(nextMorning(new Date(2026, 9, 22, 9, 0)).toString()).toBe(new Date(2026, 9, 23, 8, 0).toString());
  });
});
