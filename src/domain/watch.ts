// Fraud watch: warning signs of theft, scams and mistakes over the last days, worked out from the records Kopor
// already keeps. Nothing here accuses anyone: it shows the owner where to look, and who was involved.
import type { AuditEntry, Txn } from '@/db/schema';
import { addDays, today } from '@/lib/dates';
import { attendanceFlags } from './staff';
import type { Book } from './book';

export type FlagKind = 'short' | 'deleted' | 'refund' | 'discount' | 'lost' | 'belowCost' | 'unconfirmed' | 'momoShort' | 'attendance' | 'lateNight';
export interface Flag { kind: FlagKind; date: string; who: string; amount: number; detail: string; at?: number }

const MOMO = ['orange', 'afrimoney', 'qmoney'];
/** Discounts above this share of the sale are listed. */
export const BIG_DISCOUNT = 0.1;

export function watchFlags(book: Book, audit: AuditEntry[], days = 30, now = today()): Flag[] {
  const from = addDays(now, -days + 1);
  const name = (memberId: string | null | undefined) => book.members.find((m) => m.id === memberId)?.name ?? '—';
  const inRange = (d: string) => d >= from && d <= now;
  const flags: Flag[] = [];

  // Cash short at the end of the day, and mobile money short against the phone's messages.
  for (const c of book.closings) {
    if (!inRange(c.date)) continue;
    if (c.difference < 0) flags.push({ kind: 'short', date: c.date, who: name(c.created_by), amount: -c.difference, detail: '' });
    for (const [net, v] of Object.entries(c.momo ?? {})) {
      if (v && v.counted < v.expected) flags.push({ kind: 'momoShort', date: c.date, who: name(c.created_by), amount: v.expected - v.counted, detail: net });
    }
  }
  // Sales and credit entries removed after they were saved.
  for (const a of audit) {
    const d = new Date(a.at).toISOString().slice(0, 10);
    if (!inRange(d) || !['transactions', 'ledger'].includes(a.entity) || !/^(Deleted|Removed)\b/.test(a.summary)) continue;
    const m = a.summary.match(/(\d+(?:\.\d+)?)/);
    flags.push({ kind: 'deleted', date: d, who: a.member_name || name(a.created_by), amount: m ? Math.round(Number(m[1]) * 100) : 0, detail: a.summary, at: a.at });
  }
  const sales: Txn[] = book.txns.filter((t) => inRange(t.date));
  for (const t of sales) {
    const who = name(t.created_by);
    if (t.type === 'out' && t.category === 'refund') flags.push({ kind: 'refund', date: t.date, who, amount: t.amount, detail: t.note });
    if (t.type !== 'in') continue;
    const sub = t.amount - (t.tax ?? 0) + (t.discount ?? 0);
    if ((t.discount ?? 0) > 0 && sub > 0 && (t.discount ?? 0) / sub > BIG_DISCOUNT) flags.push({ kind: 'discount', date: t.date, who, amount: t.discount!, detail: `${Math.round(((t.discount ?? 0) / sub) * 100)}%` });
    const below = t.items.filter((i) => i.cost > 0 && i.price < i.cost);
    if (below.length) flags.push({ kind: 'belowCost', date: t.date, who, amount: below.reduce((s, i) => s + (i.cost - i.price) * i.qty, 0), detail: below.map((i) => i.name).join(', ') });
    // Paid "by mobile money" but not confirmed by Monime: check it against the network's own message, not a screenshot.
    if (MOMO.includes(t.method) && !t.verified_ref) flags.push({ kind: 'unconfirmed', date: t.date, who, amount: t.amount, detail: t.method });
    const hour = new Date(t.created_at).getHours();
    if (hour < 6 || hour >= 22) flags.push({ kind: 'lateNight', date: t.date, who, amount: t.amount, detail: new Date(t.created_at).toTimeString().slice(0, 5), at: t.created_at });
  }
  // Stock taken off by hand (damaged, lost, "counted"): the commonest way stock walks out of a shop.
  for (const m of book.moves) {
    if (!inRange(m.date) || m.reason !== 'adjust' || m.qty >= 0) continue;
    const p = book.products.find((x) => x.id === m.product_id);
    flags.push({ kind: 'lost', date: m.date, who: name(m.created_by), amount: Math.round(-m.qty * (p?.cost || p?.price || 0)), detail: `${-m.qty} ${p?.unit ?? ''} ${p?.name ?? ''}`.trim() });
  }
  for (const a of book.attendance) {
    if (!inRange(a.date)) continue;
    const f = attendanceFlags(book, a);
    if (f.length) flags.push({ kind: 'attendance', date: a.date, who: name(a.member_id), amount: 0, detail: f.join(',') });
  }
  return flags.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
}

/** Per person: how many warning signs and how much money they involve, most first. */
export function byPerson(flags: Flag[]) {
  const m = new Map<string, { who: string; count: number; amount: number; kinds: Partial<Record<FlagKind, number>> }>();
  for (const f of flags) {
    if (f.kind === 'unconfirmed') continue; // a payment to check, not a person's warning sign
    const row = m.get(f.who) ?? { who: f.who, count: 0, amount: 0, kinds: {} };
    row.count++; row.amount += f.amount; row.kinds[f.kind] = (row.kinds[f.kind] ?? 0) + 1;
    m.set(f.who, row);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}
