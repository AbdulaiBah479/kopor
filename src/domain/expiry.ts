// Expiry dates (pharmacies, provision shops): which goods still on the shelf expire soon. Each restock can carry the
// expiry date of what came in; Kopor assumes the earliest-expiring goods are sold first, so what is left on the shelf
// is the stock that expires last. Products with no dates are ignored.
import type { Product } from '@/db/schema';
import { addDays, today } from '@/lib/dates';
import { stockLevels } from './stock';
import type { Book } from './book';

export interface Batch { expiry: string; qty: number }
export const SOON_DAYS = 30;

/** What is left on the shelf, by expiry date (soonest first). Received without a date: not listed. */
export function batchesLeft(book: Book, productId: string, level = stockLevels(book).get(productId) ?? 0): Batch[] {
  const received = book.moves.filter((m) => m.product_id === productId && m.qty > 0 && (m.reason === 'restock' || m.reason === 'opening'));
  const dated = received.filter((m) => m.expiry).sort((a, b) => b.expiry!.localeCompare(a.expiry!)); // latest expiry first
  const undated = received.filter((m) => !m.expiry).reduce((s, m) => s + m.qty, 0);
  // Undated goods are counted as sold last (we cannot know), so they never hide dated stock that may expire.
  let left = Math.max(0, level - undated);
  const out: Batch[] = [];
  for (const m of dated) {
    if (left <= 0) break;
    const qty = Math.min(m.qty, left);
    const same = out.find((b) => b.expiry === m.expiry);
    if (same) same.qty += qty; else out.push({ expiry: m.expiry!, qty });
    left -= qty;
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** Stock on the shelf that has expired or expires within `days`, soonest first. */
export function expiring(book: Book, days = SOON_DAYS, now = today()): { product: Product; expiry: string; qty: number; expired: boolean }[] {
  const levels = stockLevels(book);
  const limit = addDays(now, days);
  return book.products.flatMap((p) => batchesLeft(book, p.id, levels.get(p.id) ?? 0)
    .filter((b) => b.expiry <= limit)
    .map((b) => ({ product: p, expiry: b.expiry, qty: b.qty, expired: b.expiry < now })))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** Suppliers the shop owes money to (goods bought on credit), biggest first. */
export function supplierDebts(book: Book) {
  const owed = new Map<string, number>();
  for (const e of book.ledger) owed.set(e.contact_id, (owed.get(e.contact_id) ?? 0) + (e.type === 'got' ? e.amount : -e.amount));
  return book.contacts.filter((c) => c.kind === 'supplier').map((c) => ({ contact: c, owed: owed.get(c.id) ?? 0 }))
    .filter((x) => x.owed > 0).sort((a, b) => b.owed - a.owed);
}
