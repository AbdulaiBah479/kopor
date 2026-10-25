import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, saveMember } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { closeDay } from '@/domain/closing';
import { markDay, saveTerms } from '@/domain/staff';
import { saveProduct } from '@/domain/stock';
import { bookContext } from '@/ai/assistant';
import { addDays, today } from '@/lib/dates';

let ctx: Ctx;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('what the AI advisor is told', () => {
  it('knows expiring stock for everyone; staff, pay and warning signs only for owners and managers', async () => {
    await saveProduct(ctx, { name: 'Paracetamol', unit: 'pack', price: 500, cost: 300, low_at: 0, opening: 10, expiry: addDays(today(), 5) });
    const s = await saveMember(ctx, { name: 'Sorie', phone: '077111222', role: 'cashier', branch_id: null });
    await markDay(ctx, s, today(), { status: 'absent' });
    await saveTerms(ctx, (await loadBook(ctx.orgId))!, s, { pay_type: 'monthly', amount: 2_700_000, work_days: 6 });
    await closeDay(ctx, { openingFloat: 0, counted: 0, expected: 50000 });
    const book = (await loadBook(ctx.orgId))!;
    const open = bookContext(book);
    expect(open).toContain('Paracetamol 10 pack on');
    expect(open).not.toContain('Staff this month');
    expect(open).not.toContain('Fraud watch');
    const priv = bookContext(book, today(), { private: true });
    expect(priv).toMatch(/Staff this month: .*Sorie \(cashier\): here 0 \(late 0\), absent 1, still owed/);
    expect(priv).toMatch(/Fraud watch, last 30 days .*Ama: short x1/);
  });
});
