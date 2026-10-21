import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { summary } from '@/domain/cash';
import { saveGroup, toggleContribution, lendFromGroup, repayToGroup, groupMoney, memberMoney, shareOut, groupToken, parseMembers, approveClaim, rejectClaim, pendingClaims, loanReminders } from '@/domain/groups';
import { saveGoal, moveSavings, goalProgress } from '@/domain/savings';
import { today, addDays } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('savings & loan group (VSLA)', () => {
  it('save, lend with interest, repay, then share out the box in proportion to savings', async () => {
    const g = await saveGroup(ctx, { name: 'Farmers', kind: 'savings', amount: 100000, frequency: 'weekly', start_date: today(), members: parseMembers('Mariama\nSahr'), loan_interest: 10 });
    const [mariama, sahr] = g.members;
    await toggleContribution(ctx, g, mariama.id, 1);
    await toggleContribution(ctx, g, sahr.id, 1);
    let b = await book();
    expect(groupMoney(b, g).inBox).toBe(200000);

    await lendFromGroup(ctx, b, g, { memberId: mariama.id, amount: 100000, dueDate: addDays(today(), 28) });
    b = await book();
    expect(memberMoney(b, g, mariama.id).owes).toBe(110000);           // Le 1,000 + 10% interest
    expect(groupMoney(b, g)).toMatchObject({ inBox: 100000, owed: 110000, worth: 210000 });

    await repayToGroup(ctx, b, g, mariama.id, 110000);
    b = await book();
    expect(memberMoney(b, g, mariama.id).owes).toBe(0);
    const s = shareOut(b, g);
    expect(s.inBox).toBe(210000);
    expect(s.rows.map((r) => r.share)).toEqual([105000, 105000]);      // savings back + half the interest each
    expect(s.rows.reduce((a, r) => a + r.share, 0)).toBe(s.inBox);
    expect(summary(b, today(), today()).sales).toBe(0);                 // group money is not shop money
  });

  it('cannot lend more than the box holds, or take more repayment than is owed; cashiers cannot lend', async () => {
    const g = await saveGroup(ctx, { name: 'Church fund', kind: 'savings', amount: 50000, frequency: 'monthly', start_date: today(), members: parseMembers('Fatu\nAbu') });
    await toggleContribution(ctx, g, g.members[0].id, 1);
    let b = await book();
    await expect(lendFromGroup(ctx, b, g, { memberId: g.members[1].id, amount: 60000, dueDate: '' })).rejects.toThrow('errx.potTooSmall');
    await expect(lendFromGroup({ ...ctx, role: 'cashier' }, b, g, { memberId: g.members[1].id, amount: 10000, dueDate: '' })).rejects.toThrow();
    await lendFromGroup(ctx, b, g, { memberId: g.members[1].id, amount: 10000, dueDate: '' });
    b = await book();
    await expect(repayToGroup(ctx, b, g, g.members[1].id, 20000)).rejects.toThrow('errx.repayTooMuch');
  });

  it('shares out with uneven savings and still adds up exactly', async () => {
    const g = await saveGroup(ctx, { name: 'VSLA', kind: 'savings', amount: 1000, frequency: 'weekly', start_date: addDays(today(), -14), members: parseMembers('A\nB\nC') });
    for (const r of [1, 2, 3]) await toggleContribution(ctx, g, g.members[0].id, r);
    await toggleContribution(ctx, g, g.members[1].id, 1);
    let b = await book();
    await lendFromGroup(ctx, b, g, { memberId: g.members[2].id, amount: 3000, dueDate: '' });
    b = await book();
    await repayToGroup(ctx, b, g, g.members[2].id, 3300);
    const s = shareOut(await book(), g);
    expect(s.rows.reduce((a, r) => a + r.share, 0)).toBe(4300);
    expect(s.rows[2].share).toBe(0);                                     // C saved nothing, so gets nothing
    expect(s.rows[0].share).toBeGreaterThan(s.rows[1].share);
  });

  it('member link: one secret token, renewable', async () => {
    const g = await saveGroup(ctx, { name: 'Osusu', kind: 'osusu', amount: 1000, frequency: 'weekly', start_date: today(), members: parseMembers('A') });
    const t1 = await groupToken(ctx, g);
    expect(t1.length).toBeGreaterThanOrEqual(16);
    const g2 = (await book()).groups[0];
    expect(await groupToken(ctx, g2)).toBe(t1);
    expect(await groupToken(ctx, g2, true)).not.toBe(t1);
  });
});

describe('savings goals (cashbox)', () => {
  it('tracks money set aside, the weekly amount needed, and never changes profit', async () => {
    const goal = await saveGoal(ctx, { name: 'Shop rent', target: 300000, due_date: addDays(today(), 70), kept_in: 'orange' });
    await moveSavings(ctx, await book(), goal, 100000);
    let b = await book();
    let p = goalProgress(b, goal);
    expect(p).toMatchObject({ saved: 100000, left: 200000, pct: 33, reached: false });
    expect(p.perWeek).toBe(20000);                                       // Le 2,000 left over 10 weeks
    await expect(moveSavings(ctx, b, goal, -150000)).rejects.toThrow('errx.takeTooMuch');
    await moveSavings(ctx, b, goal, -50000);
    await moveSavings(ctx, await book(), goal, 250000);
    b = await book();
    p = goalProgress(b, goal);
    expect(p).toMatchObject({ saved: 300000, reached: true, pct: 100 });
    expect(summary(b, today(), today())).toMatchObject({ sales: 0, expenses: 0, profit: 0 });
  });
});

describe("members' \"I've paid\" claims from the group link", () => {
  const claim = async (g: { id: string }, memberId: string, extra: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    await db.group_claims.put({ id, org_id: ctx.orgId, created_at: Date.now(), updated_at: Date.now(), deleted: 0, created_by: null,
      group_id: g.id, member_id: memberId, kind: 'contribution', round: 1, amount: 100000, method: 'orange', ref: 'MP1', note: '', status: 'pending', ...extra } as never);
    return id;
  };
  it('approving a contribution counts it once; approving a repayment reduces the loan; rejecting changes nothing', async () => {
    const g = await saveGroup(ctx, { name: 'VSLA', kind: 'savings', amount: 100000, frequency: 'weekly', start_date: today(), members: parseMembers('A\nB') });
    const [a, b] = g.members;
    const c1 = await claim(g, a.id);
    await approveClaim(ctx, await book(), c1);
    let bk = await book();
    expect(memberMoney(bk, g, a.id).saved).toBe(100000);
    expect(pendingClaims(bk, g.id)).toHaveLength(0);
    // Same round claimed again (e.g. sent twice): approving it does not count the money twice.
    await approveClaim(ctx, await book(), await claim(g, a.id));
    expect(memberMoney(await book(), g, a.id).saved).toBe(100000);

    await toggleContribution(ctx, g, b.id, 1);
    await lendFromGroup(ctx, await book(), g, { memberId: b.id, amount: 100000, dueDate: '' });
    await approveClaim(ctx, await book(), await claim(g, b.id, { kind: 'repay', round: null, amount: 60000 }));
    expect(memberMoney(await book(), g, b.id).owes).toBe(50000);    // 110,000 owed − 60,000 repaid

    const c3 = await claim(g, b.id, { amount: 999999 });
    await rejectClaim(ctx, c3);
    bk = await book();
    expect(memberMoney(bk, g, b.id).saved).toBe(100000);
    await expect(approveClaim(ctx, bk, c3)).rejects.toThrow();      // a decided claim cannot be approved later
  });
});

describe('loan reminders', () => {
  it('lists loans overdue or due within the reminder window, earliest first', async () => {
    const g = await saveGroup(ctx, { name: 'VSLA', kind: 'savings', amount: 100000, frequency: 'weekly', start_date: today(), members: parseMembers('A\nB\nC') });
    for (const m of g.members) await toggleContribution(ctx, g, m.id, 1);
    await lendFromGroup(ctx, await book(), g, { memberId: g.members[0].id, amount: 10000, dueDate: addDays(today(), -3) });
    await lendFromGroup(ctx, await book(), g, { memberId: g.members[1].id, amount: 10000, dueDate: addDays(today(), 2) });
    await lendFromGroup(ctx, await book(), g, { memberId: g.members[2].id, amount: 10000, dueDate: addDays(today(), 20) });
    const r = loanReminders(await book(), 3);
    expect(r.map((x) => [x.member.name, x.overdue])).toEqual([['A', true], ['B', false]]);
  });
});
