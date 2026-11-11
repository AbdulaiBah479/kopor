// Instalment plans for credit: the customer takes the goods now and pays on a fixed schedule (for example Le 500 every
// Friday for 6 weeks). Each instalment is its own credit entry with its own due date, so everything Kopor already does
// with debts works per instalment: overdue warnings, reminders, Today's to-do, the trust score, statements and BAL.
import type { LedgerEntry } from '@/db/schema';
import { atomic, type Ctx } from '@/db/repo';
import { addDays, today } from '@/lib/dates';
import { addEntry } from './credit';
import { AppError } from './book';

export type Every = 'week' | 'twoWeeks' | 'month';
export interface Instalment { n: number; due: string; amount: number }

/** The same day of the month, i months later; a day the month does not have (the 31st) falls on its last day. */
function monthsLater(first: string, i: number) {
  const y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)) - 1 + i, d = Number(first.slice(8, 10));
  const year = y + Math.floor(m / 12), month = m % 12;
  const day = Math.min(d, new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Equal parts in whole Leones; the last part takes what is left so the total is exact. */
export function schedule(total: number, count: number, every: Every, first: string): Instalment[] {
  const n = Math.max(2, Math.min(24, Math.floor(count)));
  const part = Math.floor(total / n / 100) * 100;
  return Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    due: every === 'month' ? monthsLater(first, i) : addDays(first, i * (every === 'week' ? 7 : 14)),
    amount: i === n - 1 ? total - part * (n - 1) : part,
  }));
}

export async function addInstalments(ctx: Ctx, i: { contactId: string; total: number; count: number; every: Every; first: string; note?: string; date?: string }) {
  if (!(i.total > 0)) throw new AppError('err.amount');
  const plan = schedule(Math.round(i.total), i.count, i.every, i.first);
  if (plan.some((p) => p.amount <= 0)) throw new AppError('inst.tooSmall');
  const what = i.note?.trim() || 'Goods';
  return atomic(async () => {
    const out: LedgerEntry[] = [];
    for (const p of plan) {
      out.push(await addEntry(ctx, { contactId: i.contactId, type: 'gave', amount: p.amount, note: `${what} (${p.n}/${plan.length})`.slice(0, 200), date: i.date ?? today(), dueDate: p.due }));
    }
    return out;
  });
}

/**
 * The next dated amount to pay (payments clear the oldest credit first), or null when nothing with a due date is
 * owed. Older debts without a due date are still counted against the payments, but do not hide the next instalment.
 */
export function nextToPay(ledger: LedgerEntry[], contactId: string): { amount: number; due: string | null } | null {
  const rows = ledger.filter((e) => e.contact_id === contactId && !e.deleted)
    .sort((a, b) => (a.due_date ?? a.date).localeCompare(b.due_date ?? b.date) || a.created_at - b.created_at);
  let paid = rows.filter((e) => e.type === 'got').reduce((s, e) => s + e.amount, 0);
  for (const e of rows) {
    if (e.type !== 'gave') continue;
    const covered = Math.min(paid, e.amount);
    paid -= covered;
    if (covered < e.amount && e.due_date) return { amount: e.amount - covered, due: e.due_date };
  }
  return null;
}
