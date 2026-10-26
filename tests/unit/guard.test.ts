import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg, saveMember, updateOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { recordExpense, recordSale } from '@/domain/cash';
import { addEntry, ensureContact } from '@/domain/credit';
import { closeDay } from '@/domain/closing';
import { saveProduct } from '@/domain/stock';
import { markDay } from '@/domain/staff';
import { byBranch, watchFlags } from '@/domain/watch';
import { addDays, today } from '@/lib/dates';

let ctx: Ctx, cashier: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
const kinds = async () => watchFlags(await book(), []).map((f) => f.kind);
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
  const m = await saveMember(ctx, { name: 'Sorie', phone: '077 111 222', role: 'cashier', branch_id: null });
  cashier = { ...ctx, memberId: m.id, memberName: m.name, role: 'cashier' };
});

describe('stopping fraud before it happens', () => {
  it('cashiers record only today or yesterday; managers and owners can correct older days', async () => {
    await recordSale(cashier, { method: 'cash', amount: 1000 });
    await recordSale(cashier, { method: 'cash', amount: 1000, date: addDays(today(), -1) });
    await expect(recordSale(cashier, { method: 'cash', amount: 1000, date: addDays(today(), -5) })).rejects.toThrow('err.backdated');
    await expect(recordExpense(cashier, { amount: 500, category: 'transport', date: addDays(today(), 2) })).rejects.toThrow('err.backdated');
    await expect(recordSale(ctx, { method: 'cash', amount: 1000, date: addDays(today(), -5) })).resolves.toBeTruthy();
  });

  it('a cashier cannot take a customer above the credit limit (also through a credit sale); a manager can', async () => {
    await updateOrg(ctx, { credit_limit: 50000 });
    const c = await ensureContact(cashier, 'Fatu', '076 555 444');
    await addEntry(cashier, { contactId: c.id, type: 'gave', amount: 40000 });
    await expect(addEntry(cashier, { contactId: c.id, type: 'gave', amount: 20000 })).rejects.toThrow('err.creditLimit');
    await expect(recordSale(cashier, { method: 'credit', amount: 20000, customer: 'Fatu' })).rejects.toThrow('err.creditLimit');
    expect((await book()).txns).toHaveLength(0);                      // the refused credit sale left nothing behind
    await addEntry(cashier, { contactId: c.id, type: 'got', amount: 30000 });
    await addEntry(cashier, { contactId: c.id, type: 'gave', amount: 20000 });   // paid down, so there is room again
    await addEntry(ctx, { contactId: c.id, type: 'gave', amount: 90000 });       // the owner may go above
  });
});

describe('fraud watch: new warning signs', () => {
  it('a price typed below the product price (no discount used), and a sale entered with an older date', async () => {
    const p = await saveProduct(ctx, { name: 'Oil', unit: 'tin', price: 10000, cost: 5000, low_at: 0, opening: 10 });
    await recordSale(cashier, { method: 'cash', items: [{ product_id: p.id, name: 'Oil', qty: 2, price: 7000 }] });
    const s = await recordSale(cashier, { method: 'cash', amount: 3000 });
    await db.transactions.update(s.id, { date: addDays(today(), -4) });   // e.g. changed on the phone's database
    const flags = watchFlags(await book(), []);
    expect(flags.find((f) => f.kind === 'underPriced')).toMatchObject({ who: 'Sorie', amount: 6000, detail: 'Oil' });
    expect(flags.find((f) => f.kind === 'backdated')).toMatchObject({ who: 'Sorie', amount: 3000, detail: addDays(today(), -4) });
  });

  it('records on a day the person was marked absent, and days with cash sales nobody closed', async () => {
    const sorie = (await book()).members.find((m) => m.name === 'Sorie')!;
    await markDay(ctx, sorie, today(), { status: 'absent' });
    await recordSale(cashier, { method: 'cash', amount: 2500 });
    await closeDay(ctx, { openingFloat: 0, counted: 2500, expected: 2500 });    // today is closed
    await recordSale(ctx, { method: 'cash', amount: 4000, date: addDays(today(), -2) });   // 2 days ago: never closed
    const flags = watchFlags(await book(), []);
    expect(flags.find((f) => f.kind === 'absentWork')).toMatchObject({ who: 'Sorie', amount: 2500, detail: 'absent' });
    expect(flags.find((f) => f.kind === 'noClose')).toMatchObject({ who: 'Ama', amount: 4000, date: addDays(today(), -2) });
  });

  it('credit to a staff member’s phone number, and "ghost" credit: no phone, never repaid', async () => {
    const staff = await ensureContact(ctx, 'Sorie cousin', '+232 77 111 222');      // Sorie's own number
    await addEntry(cashier, { contactId: staff.id, type: 'gave', amount: 8000 });
    const ghost = await ensureContact(cashier, 'Mr X');
    await addEntry(cashier, { contactId: ghost.id, type: 'gave', amount: 15000, date: addDays(today(), -1) });
    await db.ledger.where('contact_id').equals(ghost.id).modify({ date: addDays(today(), -20) });
    const flags = watchFlags(await book(), []);
    expect(flags.find((f) => f.kind === 'selfCredit')).toMatchObject({ who: 'Sorie', amount: 8000, detail: 'Sorie cousin' });
    expect(flags.find((f) => f.kind === 'ghostCredit')).toMatchObject({ who: 'Sorie', amount: 15000, detail: 'Mr X' });
  });

  it('a cashier expense far above the usual, counted per branch', async () => {
    for (let i = 0; i < 5; i++) await recordExpense(ctx, { amount: 1000, category: 'transport' });
    await recordExpense(cashier, { amount: 9000, category: 'transport' });
    await recordExpense(cashier, { amount: 1200, category: 'transport' });
    const flags = watchFlags(await book(), []);
    expect(flags.filter((f) => f.kind === 'bigExpense')).toMatchObject([{ who: 'Sorie', amount: 9000 }]);
    expect(byBranch(flags)[0]).toMatchObject({ branch: null, amount: 9000 });
  });

  it('a clean day has no new warning signs', async () => {
    await recordSale(cashier, { method: 'cash', amount: 1000 });
    await closeDay(cashier, { openingFloat: 0, counted: 1000, expected: 1000 });
    expect(await kinds()).toEqual([]);
  });
});
