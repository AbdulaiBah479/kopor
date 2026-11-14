import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { balances } from '@/domain/credit';
import { createInvoice } from '@/domain/invoices';
import { repeatsDue, runRepeats, setRepeat } from '@/domain/repeat';
import { addDays, today } from '@/lib/dates';
import { monthsLater } from '@/domain/instalments';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Rent Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('repeat invoices', () => {
  it('makes each month that is due, once, through the normal invoice (the customer owes each month)', async () => {
    const start = monthsLater(today(), -2);
    const tpl = await createInvoice(ctx, { customer: 'Kamara School', phone: '076 555 000', items: [{ name: 'Monthly supply', qty: 1, price: 50_000 }], date: start, dueDate: addDays(start, 10), paid: false });
    await setRepeat(ctx, tpl, true);
    expect(repeatsDue(await book()).map((i) => i.id)).toEqual([tpl.id]);
    const made = await runRepeats(ctx, await book());
    expect(made.map((i) => i.date)).toEqual([monthsLater(start, 1), monthsLater(start, 2)]);   // last month and this month
    expect(made[0].due_date).toBe(addDays(made[0].date, 10));
    const b = await book();
    expect(b.invoices.find((i) => i.id === tpl.id)?.repeat_next).toBe(monthsLater(start, 3));
    expect(balances(b.ledger).get(tpl.contact_id!)).toBe(150_000);                                // three months owed
    expect(await runRepeats(ctx, b)).toHaveLength(0);                                             // nothing twice
  });
  it('only managers and owners make them, and switching off stops them', async () => {
    const tpl = await createInvoice(ctx, { customer: 'Tenant', items: [{ name: 'Rent', qty: 1, price: 100_000 }], date: monthsLater(today(), -1), paid: false });
    await setRepeat(ctx, tpl, true);
    expect(await runRepeats({ ...ctx, role: 'cashier' }, await book())).toHaveLength(0);
    await setRepeat(ctx, (await book()).invoices[0], false);
    expect(repeatsDue(await book())).toHaveLength(0);
  });
});
