// Loyalty: every Nth visit day a customer gets a thank-you discount (owner's setting). Visits are counted as days with
// a purchase, so splitting one purchase into many small sales does not reach the reward sooner; only named customers
// with a phone number count (no reward for made-up names).
import type { Book } from './book';
import { today } from '@/lib/dates';

export interface Loyalty { visits: number; every: number; pct: number; due: boolean }

export function loyaltyFor(book: Book, customer: string, now = today()): Loyalty | null {
  const every = book.org.loyalty_every ?? 0, pct = book.org.loyalty_pct ?? 0;
  const name = customer.trim().toLowerCase();
  if (!every || !pct || !name) return null;
  const c = book.contacts.find((x) => !x.deleted && x.kind === 'customer' && x.name.toLowerCase() === name);
  if (!c || c.phone.replace(/\D/g, '').length < 8) return null;
  const days = new Set(book.txns.filter((t) => !t.deleted && t.type === 'in' && t.category === 'sale' && t.contact_id === c.id && t.date < now).map((t) => t.date));
  const boughtToday = book.txns.some((t) => !t.deleted && t.type === 'in' && t.category === 'sale' && t.contact_id === c.id && t.date === now);
  const visits = days.size + 1; // today's visit
  return { visits, every, pct, due: !boughtToday && visits % every === 0 };
}
