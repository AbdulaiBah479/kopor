// Fraud watch: warning signs of theft, scams and mistakes over the last days, worked out from the records Kopor
// already keeps. Nothing here accuses anyone: it shows the owner where to look, and who was involved.
import type { AuditEntry, Txn } from '@/db/schema';
import { addDays, today } from '@/lib/dates';
import { attendanceFlags } from './staff';
import type { Book } from './book';

export type FlagKind = 'short' | 'deleted' | 'refund' | 'discount' | 'lost' | 'belowCost' | 'unconfirmed' | 'momoShort' | 'attendance' | 'lateNight'
  | 'underPriced' | 'backdated' | 'absentWork' | 'noClose' | 'ghostCredit' | 'selfCredit' | 'bigExpense' | 'dupRef' | 'refundNoSale' | 'noItems';
/** branch: where it happened (null = the whole business or not known). */
export interface Flag { kind: FlagKind; date: string; who: string; amount: number; detail: string; at?: number; branch?: string | null }

const MOMO = ['orange', 'afrimoney', 'qmoney'];
/** Discounts above this share of the sale are listed. */
export const BIG_DISCOUNT = 0.1;
/** A line sold this far below the product's own price (without using the discount box) is listed. */
export const UNDER_PRICE = 0.1;
/** A cashier's expense this many times the business's usual (median) expense is listed. */
export const BIG_EXPENSE = 3;
/** Credit with no phone number and nothing repaid after this many days. */
export const GHOST_DAYS = 14;
/** A cashier whose sales are mostly typed as amounts only (no products), while the shop does sell products. */
export const NO_ITEMS_SHARE = 0.6, NO_ITEMS_MIN = 5;
const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const last8 = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-8);

export function watchFlags(book: Book, audit: AuditEntry[], days = 30, now = today()): Flag[] {
  const from = addDays(now, -days + 1);
  const name = (memberId: string | null | undefined) => book.members.find((m) => m.id === memberId)?.name ?? '—';
  const inRange = (d: string) => d >= from && d <= now;
  const flags: Flag[] = [];

  // Cash short at the end of the day, and mobile money short against the phone's messages.
  for (const c of book.closings) {
    if (!inRange(c.date)) continue;
    if (c.difference < 0) flags.push({ kind: 'short', date: c.date, who: name(c.created_by), amount: -c.difference, detail: c.kind === 'handover' ? 'handover' : '', branch: c.branch_id });
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
    const branch = t.branch_id;
    if (t.type === 'out' && t.category === 'refund' && !t.refund_of) flags.push({ kind: 'refundNoSale', date: t.date, who, amount: t.amount, detail: t.note, branch });
    if (t.type === 'out' && t.category === 'refund') flags.push({ kind: 'refund', date: t.date, who, amount: t.amount, detail: t.note , branch });
    if (t.type !== 'in') continue;
    const sub = t.amount - (t.tax ?? 0) + (t.discount ?? 0);
    if ((t.discount ?? 0) > 0 && sub > 0 && (t.discount ?? 0) / sub > BIG_DISCOUNT) flags.push({ kind: 'discount', date: t.date, who, amount: t.discount!, detail: `${Math.round(((t.discount ?? 0) / sub) * 100)}%` , branch });
    // Made on one day but put on another: hides it from that day's cash count.
    const made = day(t.created_at);
    if (t.date < addDays(made, -1) || t.date > addDays(made, 1)) flags.push({ kind: 'backdated', date: made, who, amount: t.amount, detail: t.date, at: t.created_at, branch });
    const below = t.items.filter((i) => i.cost > 0 && i.price < i.cost);
    // Price typed lower than the product's own price, without using the discount box (selling cheap to friends).
    const cheap = t.items.map((i) => {
      const p = i.product_id ? book.products.find((x) => x.id === i.product_id) : undefined;
      const list = !p ? 0 : (i.per ?? 1) > 1 ? p.pack_price ?? 0 : p.price;
      return { i, list };
    }).filter(({ i, list }) => list > 0 && i.price < list * (1 - UNDER_PRICE) && !(i.cost > 0 && i.price < i.cost));
    if (cheap.length) flags.push({ kind: 'underPriced', date: t.date, who, amount: cheap.reduce((s, { i, list }) => s + (list - i.price) * i.qty, 0), detail: cheap.map(({ i }) => i.name).join(', '), branch });
    if (below.length) flags.push({ kind: 'belowCost', date: t.date, who, amount: below.reduce((s, i) => s + (i.cost - i.price) * i.qty, 0), detail: below.map((i) => i.name).join(', ') , branch });
    // Paid "by mobile money" but not confirmed by Monime: check it against the network's own message, not a screenshot.
    if (MOMO.includes(t.method) && !t.verified_ref) flags.push({ kind: 'unconfirmed', date: t.date, who, amount: t.amount, detail: t.method , branch });
    const hour = new Date(t.created_at).getHours();
    if (hour < 6 || hour >= 22) flags.push({ kind: 'lateNight', date: t.date, who, amount: t.amount, detail: new Date(t.created_at).toTimeString().slice(0, 5), at: t.created_at , branch });
  }
  // Stock taken off by hand (damaged, lost, "counted"): the commonest way stock walks out of a shop.
  for (const m of book.moves) {
    if (!inRange(m.date) || m.reason !== 'adjust' || m.qty >= 0) continue;
    const p = book.products.find((x) => x.id === m.product_id);
    flags.push({ kind: 'lost', date: m.date, who: name(m.created_by), amount: Math.round(-m.qty * (p?.cost || p?.price || 0)), detail: `${-m.qty} ${p?.unit ?? ''} ${p?.name ?? ''}`.trim() });
  }
  const role = (memberId: string | null | undefined) => book.members.find((m) => m.id === memberId)?.role;
  const staffOnly = (memberId: string | null | undefined) => { const r = role(memberId); return r === 'cashier' || r === 'viewer'; };

  // Records made on a day the person was marked absent, on leave or off (someone else using their login?).
  const away = new Map(book.attendance.filter((a) => !a.deleted && ['absent', 'leave', 'off'].includes(a.status)).map((a) => [`${a.member_id}|${a.date}`, a.status]));
  const absentDays = new Map<string, Flag>();
  for (const t of sales) {
    const made = day(t.created_at), st = t.created_by && away.get(`${t.created_by}|${made}`);
    if (!st) continue;
    const k = `${t.created_by}|${made}`, cur = absentDays.get(k);
    if (cur) cur.amount += t.amount;
    else absentDays.set(k, { kind: 'absentWork', date: made, who: name(t.created_by), amount: t.amount, detail: st, branch: t.branch_id });
  }
  flags.push(...absentDays.values());

  // Days with cash sales but nobody counted the cash at the end: shortages on those days cannot be seen.
  const closed = new Set(book.closings.filter((c) => !c.deleted && c.kind !== 'handover').map((c) => `${c.branch_id ?? ''}|${c.date}`));
  const open = new Map<string, { amount: number; by: Map<string, number>; branch: string | null; date: string }>();
  for (const t of sales) {
    if (t.type !== 'in' || t.method !== 'cash' || t.date >= now) continue;
    const k = `${t.branch_id ?? ''}|${t.date}`;
    if (closed.has(k)) continue;
    const row = open.get(k) ?? { amount: 0, by: new Map(), branch: t.branch_id, date: t.date };
    row.amount += t.amount; row.by.set(t.created_by ?? '', (row.by.get(t.created_by ?? '') ?? 0) + t.amount);
    open.set(k, row);
  }
  if (book.closings.length) for (const r of open.values()) {
    const top = [...r.by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    flags.push({ kind: 'noClose', date: r.date, who: name(top), amount: r.amount, detail: '', branch: r.branch });
  }

  // Credit: to a customer a cashier made with no phone number, never repaid ("ghost" customers);
  // and credit given to a customer who has a staff member's phone number (staff giving themselves goods on credit).
  const staffByPhone = new Map(book.members.filter((m) => last8(m.phone).length === 8).map((m) => [last8(m.phone), m]));
  const repaid = new Set(book.ledger.filter((e) => !e.deleted && e.type === 'got').map((e) => e.contact_id));
  const ghost = new Map<string, Flag>();
  for (const e of book.ledger) {
    if (e.deleted || e.type !== 'gave' || !inRange(e.date)) continue;
    const c = book.contacts.find((x) => x.id === e.contact_id);
    if (!c) continue;
    const staff = staffByPhone.get(last8(c.phone));
    if (staff && staff.role !== 'owner') flags.push({ kind: 'selfCredit', date: e.date, who: staff.name, amount: e.amount, detail: c.name, branch: e.branch_id });
    if (!last8(c.phone) && c.created_by === e.created_by && staffOnly(e.created_by) && !repaid.has(c.id) && e.date <= addDays(now, -GHOST_DAYS)) {
      const cur = ghost.get(c.id);
      if (cur) cur.amount += e.amount;
      else ghost.set(c.id, { kind: 'ghostCredit', date: e.date, who: name(e.created_by), amount: e.amount, detail: c.name, branch: e.branch_id });
    }
  }
  flags.push(...ghost.values());

  // Expenses by cashiers far above the usual expense: cash taken out of the drawer "for transport", "for stock"...
  const outs = sales.filter((t) => t.type === 'out' && !['refund', 'salary', 'staff'].includes(t.category));
  const sorted = outs.map((t) => t.amount).sort((a, b) => a - b);
  const median = sorted.length >= 5 ? sorted[Math.floor(sorted.length / 2)] : 0;
  if (median > 0) for (const t of outs) {
    if (staffOnly(t.created_by) && t.amount >= median * BIG_EXPENSE) flags.push({ kind: 'bigExpense', date: t.date, who: name(t.created_by), amount: t.amount, detail: t.category, branch: t.branch_id });
  }

  // Sales typed as amounts only skip the stock: goods can leave the shop while the stock never goes down.
  if (book.products.length >= 3) {
    const per = new Map<string, { all: number; bare: number; amount: number; branch: string | null }>();
    for (const t of sales) {
      if (t.type !== 'in' || t.category !== 'sale' || !staffOnly(t.created_by) || t.invoice_id) continue;
      const r = per.get(t.created_by ?? '') ?? { all: 0, bare: 0, amount: 0, branch: t.branch_id };
      r.all++;
      if (!t.items.some((i) => i.product_id)) { r.bare++; r.amount += t.amount; }
      per.set(t.created_by ?? '', r);
    }
    for (const [id, r] of per) {
      if (r.all >= NO_ITEMS_MIN && r.bare / r.all > NO_ITEMS_SHARE) flags.push({ kind: 'noItems', date: now, who: name(id), amount: r.amount, detail: `${r.bare}/${r.all}`, branch: r.branch });
    }
  }

  // The same mobile money reference used for two group payments: one real payment claimed twice.
  const refs = new Map<string, string>();
  for (const c of [...book.groupClaims].sort((a, b) => a.created_at - b.created_at)) {
    const ref = c.ref.replace(/\s+/g, '').toUpperCase();
    if (c.deleted || c.status === 'rejected' || ref.length < 5) continue;
    const g = book.groups.find((x) => x.id === c.group_id);
    const who = g?.members.find((m) => m.id === c.member_id)?.name ?? '—';
    const d = day(c.created_at);
    if (refs.has(ref) && inRange(d)) flags.push({ kind: 'dupRef', date: d, who, amount: c.amount, detail: `${ref} · ${refs.get(ref)}`, at: c.created_at });
    else if (!refs.has(ref)) refs.set(ref, who);
  }

  for (const a of book.attendance) {
    if (!inRange(a.date)) continue;
    const f = attendanceFlags(book, a);
    if (f.length) flags.push({ kind: 'attendance', date: a.date, who: name(a.member_id), amount: 0, detail: f.join(',') });
  }
  return flags.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
}

/** Per branch: how many warning signs and how much money, so a branch with far more than the others stands out. */
export function byBranch(flags: Flag[]) {
  const m = new Map<string, { branch: string | null; count: number; amount: number }>();
  for (const f of flags) {
    if (f.kind === 'unconfirmed' || f.branch === undefined) continue;
    const k = f.branch ?? '';
    const row = m.get(k) ?? { branch: f.branch, count: 0, amount: 0 };
    row.count++; row.amount += f.amount;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
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
