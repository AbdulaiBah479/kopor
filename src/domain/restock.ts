// Restock order in one tap: Kopor builds the order from what is running low (how much was bought last time, at what
// price, from whom), the shop sends it to the supplier on WhatsApp, and when the goods arrive one tap records the
// purchase. Orders waiting for goods are kept on this phone (they are not records until the goods arrive).
import { getMeta, setMeta, type Ctx } from '@/db/repo';
import { today } from '@/lib/dates';
import { isLow, stockLevels } from './stock';
import { recordPurchase } from './stock';
import { purchasesOf } from './prices';
import type { Book } from './book';

export interface OrderLine { productId: string; name: string; unit: string; qty: number; unitCost: number }
export interface Order { id: string; supplier: string; phone: string; date: string; lines: OrderLine[] }

/** What to order: every item running low, the quantity bought last time (or enough to reach twice the alert level). */
export function reorderList(book: Book) {
  const levels = stockLevels(book);
  return book.products.filter((p) => !p.deleted && isLow(p, levels.get(p.id) ?? 0)).map((p) => {
    const last = purchasesOf(book.moves, p.id).at(-1);
    const have = levels.get(p.id) ?? 0;
    const qty = Math.max(1, last ? last.qty : Math.ceil(Math.max(p.low_at, 1) * 2 - have));
    return { productId: p.id, name: p.name, unit: p.unit, qty, unitCost: last?.unit_cost ?? p.cost, supplier: last?.supplier ?? '' };
  });
}

/** Suppliers to choose from: the shop's supplier contacts, the usual one for these items first. */
export function suppliersFor(book: Book, lines: { supplier: string }[]) {
  const count = new Map<string, number>();
  for (const l of lines) if (l.supplier) count.set(l.supplier.toLowerCase(), (count.get(l.supplier.toLowerCase()) ?? 0) + 1);
  return book.contacts.filter((c) => !c.deleted && c.kind === 'supplier')
    .sort((a, b) => (count.get(b.name.toLowerCase()) ?? 0) - (count.get(a.name.toLowerCase()) ?? 0) || a.name.localeCompare(b.name));
}

export const orderTotal = (lines: OrderLine[]) => lines.reduce((s, l) => s + l.qty * l.unitCost, 0);

const KEY = (orgId: string) => `restockOrders:${orgId}`;
export const pendingOrders = (orgId: string) => getMeta<Order[]>(KEY(orgId), []);
export async function saveOrder(orgId: string, o: Omit<Order, 'id' | 'date'>) {
  const list = await pendingOrders(orgId);
  const order = { ...o, id: crypto.randomUUID(), date: today() };
  await setMeta(KEY(orgId), [order, ...list].slice(0, 20));
  return order;
}
export async function dropOrder(orgId: string, id: string) {
  await setMeta(KEY(orgId), (await pendingOrders(orgId)).filter((o) => o.id !== id));
}

/** The goods arrived: one purchase with every line (paid now, or on credit with the supplier). */
export async function receiveOrder(ctx: Ctx, o: Order, lines: OrderLine[], method: 'cash' | 'credit') {
  const kept = lines.filter((l) => l.qty > 0);
  await recordPurchase(ctx, { lines: kept.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitCost: l.unitCost })), supplier: o.supplier, method });
  await dropOrder(ctx.orgId, o.id);
}
