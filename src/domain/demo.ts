// Realistic demo business for trying Kopor and for automated tests.
import { db } from '@/db/schema';
import { insert, update, type Ctx } from '@/db/repo';
import { uuid } from '@/lib/crypto';
import { today, addDays } from '@/lib/dates';
import { createOrg } from './org';
import { recordSale, recordExpense } from './cash';
import { saveProduct } from './stock';
import { ensureContact, addEntry } from './credit';
import { saveGroup } from './groups';

export async function createDemo(): Promise<string> {
  const { org, owner } = await createOrg({ name: "Fatu's Provisions", type: 'shop', owner: 'Fatmata Kamara', phone: '076123456' });
  await db.orgs.update(org.id, { address: 'Kissy Road, Freetown', momo_number: 'Orange Money 076 123 456', dirty: 1 });
  const ctx: Ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };

  const products: [string, number, number, number, string][] = [
    ['Rice 50kg bag', 850, 720, 80, 'bag'], ['Palm oil 4L', 180, 140, 75, 'tin'], ['Sugar 1kg', 32, 25, 100, 'packet'],
    ['Onions', 15, 10, 62, 'kg'], ['Maggi cubes (box)', 60, 45, 78, 'carton'], ['Milk tin', 25, 19, 90, 'tin'],
    ['Bread', 8, 5, 60, 'pcs'], ['Soap bar', 12, 8, 110, 'pcs'],
  ];
  for (const [name, price, cost, qty, unit] of products) await saveProduct(ctx, { name, price: price * 100, cost: cost * 100, opening: qty, unit, low_at: 5 });

  const people = [['Aminata Sesay', '076555101'], ['Mohamed Bangura', '088555202'], ['Isatu Conteh', '077555303'], ['Abu Kamara', '030555404']];
  let weekSales = 0;
  for (let i = 59; i >= 0; i--) {
    const date = addDays(today(), -i);
    const n = 2 + ((i * 7) % 4);
    for (let k = 0; k < n; k++) {
      const [name, price] = products[(i + k * 3) % products.length];
      const credit = (i + k) % 9 === 0;
      const who = people[(i + k) % 4];
      const methods = ['cash', 'orange', 'afrimoney', 'cash', 'qmoney'] as const;
      const t = await recordSale(ctx, {
        items: [{ name, qty: 1 + ((i + k) % 3), price: price * 100 }], method: credit ? 'credit' : methods[(i + k) % 5],
        customer: credit ? who[0] : '', phone: credit ? who[1] : '', date,
      });
      weekSales += t.amount;
    }
    if (i % 3 === 0) await recordExpense(ctx, { amount: (40 + (i % 5) * 15) * 100, category: ['transport', 'food', 'phone', 'utilities'][i % 4], date });
    // Restock mid-week (never "today") so the demo opens on a normal trading day.
    if (i % 7 === 3) { await recordExpense(ctx, { amount: Math.round(weekSales * 0.74), category: 'stock', note: 'Weekly restock', date }); weekSales = 0; }
    if (date.endsWith('-01')) await recordExpense(ctx, { amount: 90000, category: 'rent', note: 'Shop rent', date });
  }
  const amin = await ensureContact(ctx, 'Aminata Sesay');
  await addEntry(ctx, { contactId: amin.id, type: 'got', amount: 30000, note: 'Part payment', date: addDays(today(), -2) });
  const sup = await ensureContact(ctx, 'Kroo Bay Wholesale', '076555909', 'supplier');
  await addEntry(ctx, { contactId: sup.id, type: 'got', amount: 250000, note: 'Goods on credit', date: addDays(today(), -5) });

  const members = ['Fatmata Kamara', 'Aminata Sesay', 'Isatu Conteh', 'Mariama Jalloh', 'Hawa Turay', 'Kadiatu Koroma']
    .map((name, i) => ({ id: uuid(), name, phone: `07${i}55560${i}` }));
  const start = addDays(today(), -21);
  const g = await saveGroup(ctx, { name: 'Kissy Road Market Women Osusu', kind: 'osusu', amount: 20000, frequency: 'weekly', start_date: start, members });
  for (let r = 1; r <= 4; r++) {
    for (const [j, m] of members.entries()) {
      if (r < 4 || j % 2 === 0) await insert(ctx, 'contributions', { group_id: g.id, member_id: m.id, round: r, amount: 20000, date: addDays(start, (r - 1) * 7), method: 'cash', payment_ref: null });
    }
  }
  await update(ctx, 'groups', g.id, { payouts: { 1: start, 2: addDays(start, 7), 3: addDays(start, 14) } });
  await insert(ctx, 'members', { user_id: null, name: 'Sorie Kanu', phone: '078555777', role: 'cashier', branch_id: null, active: 1 }, 'Added staff');
  return org.id;
}
