// Business health score (0-100) and the data behind the loan-ready report.
import { today, addDays, monthStart, addMonths } from '@/lib/dates';
import type { Book } from './book';
import { summary } from './cash';
import { overdueContacts } from './credit';

export interface HealthPart { key: 'records' | 'profit' | 'credit' | 'growth'; score: number; max: number; params: Record<string, number> }

export function health(book: Book, now = today()) {
  const d30 = addDays(now, -29), d60 = addDays(now, -59), d90 = addDays(now, -89);

  const days = new Set<string>();
  for (const r of [...book.txns, ...book.ledger, ...book.contributions]) if (r.date >= d30 && r.date <= now) days.add(r.date);
  const records = Math.min(1, days.size / 20) * 30;

  const cur = summary(book, d30, now), prev = summary(book, d60, addDays(d30, -1));
  const margin = cur.sales > 0 ? cur.profit / cur.sales : 0;
  const profit = cur.sales > 0 ? Math.max(0, Math.min(1, margin / 0.2)) * 25 : 0;

  const suppliers = new Set(book.contacts.filter((c) => c.kind === 'supplier').map((c) => c.id));
  let gave = 0, got = 0;
  for (const e of book.ledger) {
    if (e.date < d90 || suppliers.has(e.contact_id)) continue;
    if (e.type === 'gave') gave += e.amount; else got += e.amount;
  }
  const overdue = overdueContacts(book, now).length;
  const collection = gave > 0 ? Math.min(1, got / gave) : 1;
  const credit = Math.max(0, collection * 25 - overdue * 2);

  let growth = 10;
  const ratio = prev.sales > 0 ? cur.sales / prev.sales : 0;
  if (prev.sales > 0) growth = ratio >= 1.1 ? 20 : ratio >= 1 ? 16 : ratio >= 0.9 ? 11 : 6;
  else if (cur.sales > 0) growth = 14;

  const parts: HealthPart[] = [
    { key: 'records', score: records, max: 30, params: { days: days.size } },
    { key: 'profit', score: profit, max: 25, params: { margin: Math.round(margin * 100), hasSales: cur.sales > 0 ? 1 : 0 } },
    { key: 'credit', score: credit, max: 25, params: { overdue, collected: Math.round(collection * 100), hasCredit: gave > 0 ? 1 : 0 } },
    { key: 'growth', score: growth, max: 20, params: { change: prev.sales ? Math.round((ratio - 1) * 100) : 0, hasPrev: prev.sales > 0 ? 1 : 0 } },
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.score, 0));
  const label = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'weak';
  return { score, label, parts, current: cur, previous: prev, activeDays: days.size };
}

export function monthlySeries(book: Book, months: number, now = today()) {
  const first = monthStart(now);
  return Array.from({ length: months }, (_, k) => {
    const from = addMonths(first, k - months + 1);
    const to = addDays(addMonths(from, 1), -1);
    return { month: from, ...summary(book, from, to) };
  });
}
