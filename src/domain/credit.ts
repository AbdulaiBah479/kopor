import { db, type Contact, type LedgerEntry } from '@/db/schema';
import { insert, update, type Ctx } from '@/db/repo';
import { assertCan } from '@/db/permissions';
import { today, addDays } from '@/lib/dates';
import { randomToken } from '@/lib/crypto';
import { AppError, findByName, type Book } from './book';

/** The secret token behind a customer's statement link. Made on first share; renewing it stops the old link working. */
export async function statementToken(ctx: Ctx, contactId: string, renew = false): Promise<string> {
  assertCan(ctx.role, 'record');
  const c = await db.contacts.get(contactId);
  if (!c || c.deleted) throw new AppError('err.notFound');
  if (c.public_token && !renew) return c.public_token;
  const public_token = randomToken();
  await update(ctx, 'contacts', contactId, { public_token }, `${renew ? 'New statement link' : 'Statement link'} for ${c.name}`);
  return public_token;
}

/** Positive = they owe you. Negative = you owe them. */
export function balances(ledger: LedgerEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of ledger) m.set(e.contact_id, (m.get(e.contact_id) ?? 0) + (e.type === 'gave' ? e.amount : -e.amount));
  return m;
}

/** A debt is overdue if, after applying payments to the oldest credit first, an unpaid credit is past its due date. */
export function overdueSince(ledger: LedgerEntry[], contactId: string, now = today()): string | null {
  const rows = ledger.filter((e) => e.contact_id === contactId).sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at);
  let paid = rows.filter((e) => e.type === 'got').reduce((s, e) => s + e.amount, 0);
  for (const e of rows) {
    if (e.type !== 'gave') continue;
    const covered = Math.min(paid, e.amount);
    paid -= covered;
    if (covered < e.amount && e.due_date && e.due_date < now) return e.due_date;
  }
  return null;
}

export function creditTotals(book: Book) {
  let get = 0, give = 0;
  for (const [, b] of balances(book.ledger)) { if (b > 0) get += b; else give -= b; }
  return { get, give };
}

export function overdueContacts(book: Book, now = today()) {
  const bal = balances(book.ledger);
  return book.contacts
    .filter((c) => (bal.get(c.id) ?? 0) > 0)
    .map((c) => ({ contact: c, balance: bal.get(c.id) ?? 0, since: overdueSince(book.ledger, c.id, now) }))
    .filter((x) => x.since) as { contact: Contact; balance: number; since: string }[];
}

/** Debts due within `days` days (for proactive reminders). */
export function dueSoon(book: Book, days: number, now = today()) {
  const bal = balances(book.ledger);
  const lim = addDays(now, days);
  const out = new Map<string, string>();
  for (const e of book.ledger) {
    if (e.type === 'gave' && e.due_date && e.due_date >= now && e.due_date <= lim && (bal.get(e.contact_id) ?? 0) > 0) {
      const prev = out.get(e.contact_id);
      if (!prev || e.due_date < prev) out.set(e.contact_id, e.due_date);
    }
  }
  return [...out].map(([id, due]) => ({ contact: book.contacts.find((c) => c.id === id)!, due, balance: bal.get(id) ?? 0 })).filter((x) => x.contact);
}

export async function ensureContact(ctx: Ctx, name: string, phone = '', kind: Contact['kind'] = 'customer'): Promise<Contact> {
  const clean = name.trim();
  if (!clean) throw new AppError('err.nameRequired');
  const all = (await db.contacts.where('org_id').equals(ctx.orgId).toArray()).filter((c) => !c.deleted);
  const found = findByName(all, clean);
  if (found) {
    if (phone && !found.phone) return update(ctx, 'contacts', found.id, { phone }, `Added phone for ${found.name}`);
    return found;
  }
  return insert(ctx, 'contacts', { name: clean, phone: phone.trim(), kind, notes: '' }, `New contact ${clean}`);
}

export interface EntryInput {
  contactId: string; type: 'gave' | 'got'; amount: number; note?: string; date?: string; dueDate?: string | null;
  refType?: string | null; refId?: string | null;
}
/** Remove a credit-book entry (own entries can be undone for 10 minutes by any role). */
export async function removeEntry(ctx: Ctx, id: string) {
  const e = await db.ledger.get(id);
  if (!e) throw new AppError('err.notFound');
  const own = !!ctx.memberId && e.created_by === ctx.memberId && Date.now() - e.created_at < 10 * 60_000;
  if (!own) assertCan(ctx.role, 'edit');
  await update(ctx, 'ledger', id, { deleted: 1 }, `Removed ${e.type === 'gave' ? 'credit' : 'payment'} ${e.amount / 100}`);
}

export async function addEntry(ctx: Ctx, i: EntryInput): Promise<LedgerEntry> {
  assertCan(ctx.role, 'record');
  if (!(i.amount > 0)) throw new AppError('err.amount');
  return insert(ctx, 'ledger', {
    branch_id: ctx.branchId, contact_id: i.contactId, type: i.type, amount: Math.round(i.amount), note: i.note?.trim() ?? '',
    date: i.date || today(), due_date: i.type === 'gave' ? i.dueDate || null : null, ref_type: i.refType ?? null, ref_id: i.refId ?? null,
  }, `${i.type === 'gave' ? 'Credit given' : 'Payment received'} ${i.amount / 100}`);
}
