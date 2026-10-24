import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, saveMember } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { summary } from '@/domain/cash';
import { attendanceId, markDay, monthOf, payFor, recordPay, saveTerms, tapIn, tapOut, workingDays } from '@/domain/staff';
import { today } from '@/lib/dates';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;

beforeEach(async () => {
  await db.delete();
  await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('staff attendance and salaries', () => {
  it('counts working days (Monday first)', () => {
    expect(workingDays('2026-10', 6)).toHaveLength(27); // October 2026 has 4 Sundays
    expect(workingDays('2026-10', 5)).toHaveLength(22);
    expect(workingDays('2026-10', 7)).toHaveLength(31);
    expect(workingDays('2026-10', 6, '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']); // Thu, Fri, Sat
  });

  it('one row per person per day, even when marked twice (or on two phones)', async () => {
    const m = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    expect(await attendanceId(ctx.orgId, m.id, '2026-10-05')).toBe(await attendanceId(ctx.orgId, m.id, '2026-10-05'));
    expect(await attendanceId(ctx.orgId, m.id, '2026-10-05')).not.toBe(await attendanceId(ctx.orgId, m.id, '2026-10-06'));
    await markDay(ctx, m, '2026-10-05', { status: 'present' });
    await markDay(ctx, m, '2026-10-05', { status: 'absent' });
    const rows = (await book()).attendance.filter((a) => a.member_id === m.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('absent');
  });

  it('tap in: on time or late, and the first arrival time is kept; tap out records leaving', async () => {
    const m = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    const at = (h: number, min: number) => { const d = new Date(); d.setHours(h, min, 0, 0); return d; };
    await tapIn(ctx, await book(), m, at(9, 5));
    await tapIn(ctx, await book(), m, at(10, 0));
    await tapOut(ctx, await book(), m, at(17, 30));
    const day = (await book()).attendance.find((a) => a.member_id === m.id)!;
    expect(day).toMatchObject({ status: 'late', time_in: '09:05', time_out: '17:30' });
  });

  it('a cashier can mark only themselves', async () => {
    const me = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    const other = await saveMember(ctx, { name: 'Fatu', phone: '077333444', role: 'cashier', branch_id: null });
    const cashier: Ctx = { ...ctx, memberId: me.id, memberName: me.name, role: 'cashier' };
    await markDay(cashier, me, today(), { status: 'present' });
    await expect(markDay(cashier, other, today(), { status: 'absent' })).rejects.toThrow(/not allowed/);
  });

  it('monthly salary: absences cost a day’s pay; unmarked days are paid; advances come off; payments are expenses', async () => {
    const m = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    await saveTerms(ctx, await book(), m, { pay_type: 'monthly', amount: 2_700_000, work_days: 6 }); // Le 27,000 a month
    const month = '2026-10'; // 27 working days -> Le 1,000 a day
    await markDay(ctx, m, '2026-10-05', { status: 'absent' });
    await markDay(ctx, m, '2026-10-06', { status: 'half' });
    await markDay(ctx, m, '2026-10-07', { status: 'leave' });
    let p = payFor(await book(), m.id, month);
    expect(p.workingDays).toBe(27);
    expect(p.earned).toBe(2_700_000 - 100_000 - 50_000);   // one absent day + half a day
    await recordPay(ctx, m, 'advance', 500_000, { month });
    await recordPay(ctx, m, 'bonus', 200_000, { month });
    await recordPay(ctx, m, 'deduction', 50_000, { month, note: 'broken bottle' });
    p = payFor(await book(), m.id, month);
    expect(p.due).toBe(2_550_000 + 200_000 - 50_000 - 500_000);
    await recordPay(ctx, m, 'salary', p.due, { month });
    p = payFor(await book(), m.id, month);
    expect(p.balance).toBe(0);
    // Advance and salary are money out of the cash book; the bonus and deduction are not.
    const b = await book();
    const out = b.txns.filter((t) => t.category === 'salaries');
    expect(out.map((t) => t.amount).sort((x, y) => x - y)).toEqual([500_000, 2_200_000]);
    expect(summary(b, today(), today()).expenses).toBeGreaterThanOrEqual(2_700_000);
  });

  it('daily rate: paid for the days worked', async () => {
    const m = await saveMember(ctx, { name: 'Musa', phone: '077555666', role: 'viewer', branch_id: null });
    await saveTerms(ctx, await book(), m, { pay_type: 'daily', amount: 50_000, work_days: 6 });
    for (const [d, s] of [['01', 'present'], ['02', 'late'], ['03', 'half'], ['05', 'absent']] as const) await markDay(ctx, m, `2026-10-${d}`, { status: s });
    expect(payFor(await book(), m.id, '2026-10').earned).toBe(50_000 * 2.5);
  });

  it('only the owner sets pay; managers record payments', async () => {
    const m = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    const manager: Ctx = { ...ctx, role: 'manager' };
    await expect(saveTerms(manager, await book(), m, { pay_type: 'monthly', amount: 1, work_days: 6 })).rejects.toThrow(/not allowed/);
    await expect(recordPay({ ...ctx, role: 'cashier' }, m, 'advance', 1000)).rejects.toThrow(/not allowed/);
    await recordPay(manager, m, 'advance', 1000, { month: monthOf(today()) });
  });
});
