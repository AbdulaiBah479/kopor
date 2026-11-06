import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, saveMember } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { agentState, checkBalances, recordAgent } from '@/domain/agent';

let ctx: Ctx, cashier: Ctx;
const moves = async () => (await loadBook(ctx.orgId))!.agentMoves;
const wait = () => new Promise((r) => setTimeout(r, 3)); // records made in the same millisecond keep their order
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Agent Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
  const m = await saveMember(ctx, { name: 'Sorie', phone: '077 111 222', role: 'cashier', branch_id: null });
  cashier = { ...ctx, memberId: m.id, memberName: m.name, role: 'cashier' };
});

describe('mobile money agent book', () => {
  it('moves money between cash and float the right way', async () => {
    await checkBalances(ctx, { cash: 500_000, orange: 1_000_000 }); await wait();
    await recordAgent(cashier, await moves(), { kind: 'deposit', network: 'orange', amount: 200_000, phone: '076 123 456' }); await wait();
    await recordAgent(cashier, await moves(), { kind: 'withdraw', network: 'orange', amount: 50_000 }); await wait();
    await recordAgent(cashier, await moves(), { kind: 'commission', network: 'orange', amount: 1_500 });
    const s = agentState(await moves());
    expect(s.balance.cash).toBe(500_000 + 200_000 - 50_000);
    expect(s.balance.orange).toBe(1_000_000 - 200_000 + 50_000 + 1_500);
    expect(s.day).toMatchObject({ deposits: 200_000, withdrawals: 50_000, commission: 1_500, count: 3 });
    expect(s.commissionMonth).toBe(1_500);
    expect((await moves()).find((m) => m.kind === 'deposit')?.phone).toBe('076123456');
  });

  it('refuses a deposit bigger than the float, or a withdrawal bigger than the cash', async () => {
    await checkBalances(ctx, { cash: 10_000, afrimoney: 30_000 }); await wait();
    await expect(recordAgent(cashier, await moves(), { kind: 'deposit', network: 'afrimoney', amount: 40_000 })).rejects.toThrow('agent.noFloat');
    await expect(recordAgent(cashier, await moves(), { kind: 'withdraw', network: 'afrimoney', amount: 20_000 })).rejects.toThrow('agent.noCash');
    // A network never checked is not known yet, so nothing is refused for it.
    await expect(recordAgent(cashier, await moves(), { kind: 'deposit', network: 'qmoney', amount: 40_000 })).resolves.toBeTruthy();
  });

  it('a balance check shows the money missing from the drawer or a SIM', async () => {
    await checkBalances(ctx, { cash: 100_000, orange: 100_000 }); await wait();
    await recordAgent(cashier, await moves(), { kind: 'deposit', network: 'orange', amount: 40_000 }); await wait();
    await checkBalances(ctx, { cash: 130_000, orange: 60_000 });   // the drawer should hold 140,000
    const s = agentState(await moves());
    expect(s.lastCheck.cash).toMatchObject({ expected: 140_000, counted: 130_000, diff: -10_000 });
    expect(s.lastCheck.orange?.diff).toBe(0);
    expect(s.balance.cash).toBe(130_000);                          // the count is the new starting point
  });
});
