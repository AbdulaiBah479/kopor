import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { addEntry, ensureContact } from '@/domain/credit';
import { addDays, today } from '@/lib/dates';
import { audienceOf, personal } from '@/domain/audience';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
const names = async (a: Parameters<typeof audienceOf>[1]) => audienceOf(await book(), a).map((c) => c.name).sort();
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Msg Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('messages to customers', () => {
  it('picks recent customers, the ones who stopped coming, and the ones who owe', async () => {
    const fatu = await ensureContact(ctx, 'Fatu Kamara', '076 111 222');
    const musa = await ensureContact(ctx, 'Musa Bangura', '077 333 444');
    await ensureContact(ctx, 'No Phone', '');
    await ensureContact(ctx, 'Alie Wholesale', '078 555 666', 'supplier');
    await addEntry(ctx, { contactId: fatu.id, type: 'gave', amount: 5000 });                                  // today, owes
    await addEntry(ctx, { contactId: musa.id, type: 'gave', amount: 3000, date: addDays(today(), -45) });
    await addEntry(ctx, { contactId: musa.id, type: 'got', amount: 3000, date: addDays(today(), -40) });     // paid, then stopped coming
    expect(await names('all')).toEqual(['Fatu Kamara', 'Musa Bangura']);                                        // no suppliers, no numberless
    expect(await names('recent')).toEqual(['Fatu Kamara']);
    expect(await names('away')).toEqual(['Musa Bangura']);
    expect(await names('owe')).toEqual(['Fatu Kamara']);
  });
  it('fills in each customer’s first name', () => {
    expect(personal('Hello {name}, new stock!', { name: 'Fatu Kamara' })).toBe('Hello Fatu, new stock!');
  });
});
