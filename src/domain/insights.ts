// Offline "smart" insights: rule-based, instant, free, and private. The AI assistant adds conversation on top.
import { today, addDays } from '@/lib/dates';
import type { Book } from './book';
import { summary, topProducts } from './cash';
import { overdueContacts, dueSoon } from './credit';
import { forecast, stockLevels } from './stock';
import { currentRound, roundStatus } from './groups';

export interface Insight { id: string; tone: 'good' | 'warn' | 'bad' | 'info'; key: string; params: Record<string, string | number>; link?: string }

export function insights(book: Book, now = today()): Insight[] {
  const out: Insight[] = [];
  const w = summary(book, addDays(now, -6), now), pw = summary(book, addDays(now, -13), addDays(now, -7));
  if (pw.sales > 0) {
    const change = Math.round((w.sales / pw.sales - 1) * 100);
    if (Math.abs(change) >= 10) out.push({ id: 'trend', tone: change > 0 ? 'good' : 'warn', key: change > 0 ? 'ins.salesUp' : 'ins.salesDown', params: { pct: Math.abs(change) }, link: '/cash' });
  }

  const od = overdueContacts(book, now);
  if (od.length) {
    const worst = od.sort((a, b) => b.balance - a.balance)[0];
    out.push({ id: 'overdue', tone: 'bad', key: 'ins.overdue', params: { count: od.length, name: worst.contact.name, amount: worst.balance }, link: `/credit/${worst.contact.id}` });
  }
  const soon = dueSoon(book, book.org.reminder_days || 2, now);
  if (soon.length) out.push({ id: 'dueSoon', tone: 'info', key: 'ins.dueSoon', params: { count: soon.length }, link: '/reminders' });

  const levels = stockLevels(book);
  const runningOut = book.products
    .map((p) => ({ p, f: forecast(book, p.id, 14, now), qty: levels.get(p.id) ?? 0 }))
    .filter((x) => x.f.daysLeft !== null && x.f.daysLeft <= 5 && x.qty > 0)
    .sort((a, b) => (a.f.daysLeft ?? 0) - (b.f.daysLeft ?? 0));
  if (runningOut.length) out.push({ id: 'runout', tone: 'warn', key: 'ins.runningOut', params: { name: runningOut[0].p.name, days: runningOut[0].f.daysLeft ?? 0 }, link: '/stock' });

  const top = topProducts(book, addDays(now, -29), now, 1)[0];
  if (top) out.push({ id: 'top', tone: 'info', key: 'ins.topProduct', params: { name: top.name, amount: top.amount }, link: '/stock' });

  const m = summary(book, addDays(now, -29), now);
  if (m.sales > 0 && m.profit < 0) out.push({ id: 'loss', tone: 'bad', key: 'ins.loss', params: { amount: -m.profit }, link: '/cash' });
  const biggest = Object.entries(
    book.txns.filter((t) => t.type === 'out' && t.date >= addDays(now, -29)).reduce<Record<string, number>>((a, t) => ({ ...a, [t.category]: (a[t.category] ?? 0) + t.amount }), {}),
  ).sort((a, b) => b[1] - a[1])[0];
  if (biggest && m.expenses > 0 && biggest[0] !== 'stock' && biggest[1] / m.expenses > 0.3) {
    out.push({ id: 'expense', tone: 'info', key: 'ins.bigExpense', params: { cat: biggest[0], pct: Math.round((biggest[1] / m.expenses) * 100) }, link: '/cash' });
  }

  for (const g of book.groups) {
    const r = currentRound(g, now);
    const s = roundStatus(book, g, r);
    if (s.unpaid.length) { out.push({ id: 'group-' + g.id, tone: 'warn', key: 'ins.groupUnpaid', params: { name: g.name, count: s.unpaid.length, round: r }, link: `/groups/${g.id}` }); break; }
  }
  return out;
}
