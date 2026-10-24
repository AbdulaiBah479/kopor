import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { createOrg } from '@/domain/org';
import { loadBook } from '@/domain/book';
import { balances } from '@/domain/credit';
import { stockLevels } from '@/domain/stock';
import { customersFromTable, importCustomers, importProducts, parseVcf, productsFromTable } from '@/domain/importer';

let ctx: Ctx;
const book = async () => (await loadBook(ctx.orgId))!;
beforeEach(async () => {
  await db.delete(); await db.open();
  const { org, owner } = await createOrg({ name: 'Test Shop', type: 'shop', owner: 'Ama', phone: '076000000' });
  ctx = { orgId: org.id, memberId: owner.id, memberName: owner.name, branchId: null, role: 'owner' };
});

describe('importing existing records', () => {
  it('finds the columns by their names (English, Krio, French) and reads amounts like 1,500', () => {
    expect(customersFromTable([['Nem', 'Fon nɔmba', 'Dɛn ɔw'], ['Fatmata Kamara', '076 123 456', '1,500'], ['', '', ''], ['Sorie', '', '250']]))
      .toEqual([{ name: 'Fatmata Kamara', phone: '076123456', owes: 150000 }, { name: 'Sorie', phone: '', owes: 25000 }]);
    expect(productsFromTable([['Produit', 'Prix de vente', 'Coût', 'Quantité'], ['Riz 50kg', '850', '720', '12']]))
      .toEqual([{ name: 'Riz 50kg', price: 85000, cost: 72000, qty: 12, low: 0, unit: 'pcs' }]);
    // "Cost price" is the cost, "Selling price" the price, whatever their order.
    expect(productsFromTable([['Item', 'Cost price', 'Selling price', 'Stock', 'Reorder at', 'Unit'], ['Soap bar', '9', '12', '40', '10', 'bar']])[0])
      .toEqual({ name: 'Soap bar', price: 1200, cost: 900, qty: 40, low: 10, unit: 'bar' });
    // No header row: name, phone, amount.
    expect(customersFromTable([['Mariama', '+232 77 000 111', '300']])).toEqual([{ name: 'Mariama', phone: '+23277000111', owes: 30000 }]);
  });

  it('reads contacts exported from a phone (.vcf)', () => {
    const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Aminata Sesay\r\nTEL;TYPE=CELL:+232 76 555 222\r\nEND:VCARD\r\nBEGIN:VCARD\r\nN:Bangura;Musa;;;\r\nTEL:088111222\r\nEND:VCARD\r\n';
    expect(parseVcf(vcf)).toEqual([{ name: 'Aminata Sesay', phone: '+23276555222', owes: 0 }, { name: 'Musa Bangura', phone: '088111222', owes: 0 }]);
  });

  it('adds new customers with their opening balance and leaves existing ones alone', async () => {
    await importCustomers(ctx, await book(), [{ name: 'Fatmata', phone: '', owes: 0 }]);
    const r = await importCustomers(ctx, await book(), [{ name: 'Fatmata', phone: '076123456', owes: 99900 }, { name: 'Sorie', phone: '', owes: 25000 }]);
    expect(r).toEqual({ added: 1, existing: 1, balances: 1 });
    const b = await book();
    const bal = balances(b.ledger);
    expect(bal.get(b.contacts.find((c) => c.name === 'Sorie')!.id)).toBe(25000);
    expect(bal.get(b.contacts.find((c) => c.name === 'Fatmata')!.id) ?? 0).toBe(0);           // no duplicate balance
    expect(b.contacts.find((c) => c.name === 'Fatmata')!.phone).toBe('076123456');              // phone filled in
  });

  it('adds products with opening stock; skips ones already there and repeated rows', async () => {
    const rows = [{ name: 'Rice', price: 85000, cost: 72000, qty: 12, low: 2, unit: 'bag' }, { name: 'rice', price: 1, cost: 1, qty: 1, low: 0, unit: 'bag' }, { name: 'Sugar', price: 2500, cost: 2000, qty: 0, low: 0, unit: 'kg' }];
    expect(await importProducts(ctx, await book(), rows)).toEqual({ added: 2, existing: 1 });
    const b = await book();
    expect(stockLevels(b).get(b.products.find((p) => p.name === 'Rice')!.id)).toBe(12);
    expect(await importProducts(ctx, await book(), rows)).toEqual({ added: 0, existing: 3 });
  });
});
