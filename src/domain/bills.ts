// Bills and cash plan. Rent, school fees, loan repayments and electricity come round every month or week, and a shop
// that spent its cash on stock gets caught short. The owner lists the regular bills once; Kopor shows what is due in
// the next 30 days next to the money the shop has now (drawer and mobile money), and warns before it runs short.
// Stored with the business (orgs.bills, migration 0044). Paying a bill records it as an expense.
import type { Org } from '@/db/schema';
import type { Ctx } from '@/db/repo';
import { addDays, daysBetween, today } from '@/lib/dates';
import { recordExpense } from './cash';
import { updateOrg } from './org';
import { moneyNow } from './moneyNow';
import { suppliersToPay } from './expiry';
import { AppError, type Book } from './book';

export interface Bill {
  id: string; name: string; amount: number; category: string;
  every: 'month' | 'week' | 'once';
  day: number;            // month: day of the month (1-31); week: 0 = Monday … 6 = Sunday
  date?: string | null;   // once: the date it is due
  start: string;          // first day it counts from
  paid?: string | null;   // the last due date that was paid
}
export interface Due { bill: Bill; due: string; late: boolean }

const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The first due date on or after `from` (a day of the month that does not exist, like the 31st, falls on the last day). */
export function dueOnOrAfter(bill: Bill, from: string): string | null {
  if (bill.every === 'once') return bill.date && bill.date >= from ? bill.date : null;
  if (bill.every === 'week') {
    const wd = (new Date(`${from}T12:00:00`).getDay() + 6) % 7; // Monday = 0
    return addDays(from, (bill.day - wd + 7) % 7);
  }
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1;
  for (let i = 0; i < 2; i++) {
    const d = iso(y, m, Math.min(bill.day, lastDay(y, m)));
    if (d >= from) return d;
    m++; if (m > 11) { m = 0; y++; }
  }
  return null;
}

/** Every unpaid due date of a bill up to `until` (earlier unpaid ones count as late). */
export function duesOf(bill: Bill, until: string, now = today()): Due[] {
  const out: Due[] = [];
  let from = bill.paid ? addDays(bill.paid, 1) : bill.start;
  for (let i = 0; i < 60; i++) {
    const d = dueOnOrAfter(bill, from);
    if (!d || d > until) break;
    out.push({ bill, due: d, late: d < now });
    if (bill.every === 'once') break;
    from = addDays(d, 1);
  }
  return out;
}

export const billsOf = (org: Org): Bill[] => (Array.isArray(org.bills) ? org.bills : []);

/** What must be paid in the next `days` days, against the money the shop has now. */
export function cashPlan(book: Book, days = 30, now = today()) {
  const until = addDays(now, days);
  const dues = billsOf(book.org).flatMap((b) => duesOf(b, until, now)).sort((a, b) => a.due.localeCompare(b.due));
  const suppliers = suppliersToPay(book, now, days);
  const m = moneyNow(book, now);
  const have = Math.max(0, m.drawer) + m.momo.reduce((s, [, v]) => s + Math.max(0, v), 0);
  const billsTotal = dues.reduce((s, d) => s + d.bill.amount, 0), supplierTotal = suppliers.reduce((s, x) => s + x.owed, 0);
  const week = addDays(now, 7);
  const dueWeek = dues.filter((d) => d.due <= week).reduce((s, d) => s + d.bill.amount, 0)
    + suppliers.filter((x) => x.due! <= week).reduce((s, x) => s + x.owed, 0);
  return { dues, suppliers, have, billsTotal, supplierTotal, total: billsTotal + supplierTotal, dueWeek, shortWeek: Math.max(0, dueWeek - have), short: Math.max(0, billsTotal + supplierTotal - have) };
}

export const daysTo = (due: string, now = today()) => daysBetween(now, due);

export interface BillInput { name: string; amount: number; category: string; every: Bill['every']; day: number; date?: string | null }
export async function saveBill(ctx: Ctx, org: Org, input: BillInput, id?: string) {
  if (!input.name.trim()) throw new AppError('err.nameRequired');
  if (!(input.amount > 0)) throw new AppError('err.amount');
  if (input.every === 'once' && !input.date) throw new AppError('bills.needDate');
  const list = billsOf(org);
  const clean = { name: input.name.trim().slice(0, 60), amount: Math.round(input.amount), category: input.category || 'other', every: input.every,
    day: input.every === 'week' ? Math.min(6, Math.max(0, input.day)) : Math.min(31, Math.max(1, input.day || 1)), date: input.every === 'once' ? input.date : null };
  const next = id ? list.map((b) => (b.id === id ? { ...b, ...clean } : b))
    : [...list, { ...clean, id: crypto.randomUUID(), start: today(), paid: null }];
  if (next.length > 50) throw new AppError('bills.tooMany');
  return updateOrg(ctx, { bills: next });
}
export const removeBill = (ctx: Ctx, org: Org, id: string) => updateOrg(ctx, { bills: billsOf(org).filter((b) => b.id !== id) });

/** Pay one due date: an expense in the cash book, and the bill moves on to its next due date. */
export async function payBill(ctx: Ctx, org: Org, due: Due, method: 'cash' | 'orange' | 'afrimoney' | 'qmoney' | 'bank' = 'cash') {
  await recordExpense(ctx, { amount: due.bill.amount, category: due.bill.category, method, note: due.bill.name });
  return updateOrg(ctx, { bills: billsOf(org).map((b) => (b.id === due.bill.id ? { ...b, paid: due.due } : b)) });
}
