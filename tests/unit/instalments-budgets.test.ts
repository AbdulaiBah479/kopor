import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, updateOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordExpense } from '@/domain/cash';
import { addEntry, balances, ensureContact, overdueContacts } from '@/domain/credit';
import { addDays, today } from '@/lib/dates';
import { addInstalments, nextToPay, schedule } from '@/domain/instalments';
import { budgetStatus } from '@/domain/budgets';
import { todayList } from '@/domain/todo';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Plan Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('instalment plans', () => {
  it('splits into equal whole-Leone parts; the last takes the rest', () => {
    const s = schedule(100_000, 3, 'week', '2026-11-13');
    expect(s.map((p) => [p.due, p.amount])).toEqual([['2026-11-13', 33_300], ['2026-11-20', 33_300], ['2026-11-27', 33_400]]);
    expect(schedule(90_000, 3, 'month', '2026-01-31').map((p) => p.due)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(schedule(90_000, 2, 'month', '2026-12-15').map((p) => p.due)).toEqual(['2026-12-15', '2027-01-15']);
  });
  it('each instalment is its own debt with its own date: the next one to pay, and late ones show as overdue', async () => {
    const c = await ensureContact(ctx, 'Fatu', '076 111 222');
    await addInstalments(ctx, { contactId: c.id, total: 300_000, count: 3, every: 'week', first: addDays(today(), -8), note: 'Tecno phone' });
    let b = await book();
    expect(balances(b.ledger).get(c.id)).toBe(300_000);
    expect(b.ledger.map((e) => e.note).sort()).toEqual(['Tecno phone (1/3)', 'Tecno phone (2/3)', 'Tecno phone (3/3)']);
    expect(nextToPay(b.ledger, c.id)).toEqual({ amount: 100_000, due: addDays(today(), -8) });
    expect(overdueContacts(b).map((o) => o.contact.name)).toEqual(['Fatu']);    // the first instalment is late
    await addEntry(ctx, { contactId: c.id, type: 'got', amount: 130_000 });
    b = await book();
    expect(nextToPay(b.ledger, c.id)).toEqual({ amount: 70_000, due: addDays(today(), -1) });
  });
  it('an older debt without a due date does not hide the next instalment', async () => {
    const c = await ensureContact(ctx, 'Haja', '076 900 111');
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 125_000, date: addDays(today(), -30), dueDate: null });
    await addInstalments(ctx, { contactId: c.id, total: 30_000, count: 3, every: 'week', first: addDays(today(), 7) });
    expect(nextToPay((await book()).ledger, c.id)).toEqual({ amount: 10_000, due: addDays(today(), 7) });
  });
});

describe('expense budgets', () => {
  it('shows how much of each budget is used, and the to-do warns when one is over', async () => {
    await updateOrg(ctx, { budgets: { transport: 50_000, food: 100_000 } });
    await recordExpense(ctx, { amount: 42_000, category: 'transport' });
    await recordExpense(ctx, { amount: 120_000, category: 'food' });
    await recordExpense(ctx, { amount: 500_000, category: 'stock' });             // buying stock is not spending
    const lines = budgetStatus(await book());
    expect(lines.map((l) => [l.category, l.state, l.pct])).toEqual([['food', 'over', 120], ['transport', 'near', 84]]);
    const todo = todayList(await book());
    expect(todo.filter((i) => i.kind === 'budget').map((i) => [i.params.category, i.urgent])).toEqual([['food', true], ['transport', false]]);
  });
});
