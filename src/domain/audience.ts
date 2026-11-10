// Who receives a message to customers: everyone, recent customers, customers who stopped coming, or customers who owe.
import type { Contact } from '@/db/schema';
import { addDays, today } from '@/lib/dates';
import { balances } from './credit';
import type { Book } from './book';

export type Audience = 'all' | 'recent' | 'away' | 'owe';
export const AUDIENCES: Audience[] = ['all', 'recent', 'away', 'owe'];
const AWAY_DAYS = 30;

/** The last day each customer bought, took credit, paid or got an invoice. */
export function lastSeen(book: Book): Map<string, string> {
  const seen = new Map<string, string>();
  const mark = (id: string | null | undefined, date: string) => { if (id && date > (seen.get(id) ?? '')) seen.set(id, date); };
  for (const x of book.txns) if (!x.deleted) mark(x.contact_id, x.date);
  for (const e of book.ledger) if (!e.deleted) mark(e.contact_id, e.date);
  for (const i of book.invoices) if (!i.deleted) mark(i.contact_id, i.date);
  return seen;
}

export function audienceOf(book: Book, a: Audience, now = today()): Contact[] {
  const people = book.contacts.filter((c) => !c.deleted && c.kind !== 'supplier' && c.phone.replace(/\D/g, '').length >= 8);
  if (a === 'all') return people;
  if (a === 'owe') { const b = balances(book.ledger); return people.filter((c) => (b.get(c.id) ?? 0) > 0); }
  const seen = lastSeen(book), since = addDays(now, -AWAY_DAYS);
  return people.filter((c) => { const d = seen.get(c.id); return a === 'recent' ? !!d && d >= since : !!d && d < since; });
}

/** The message for one customer: {name} becomes their first name. */
export const personal = (text: string, c: Pick<Contact, 'name'>) => text.replaceAll('{name}', c.name.split(' ')[0]);
