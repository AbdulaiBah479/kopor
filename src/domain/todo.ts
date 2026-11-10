// Today's to-do list (Home): the few things that lose money if forgotten, in one short list each morning: debts to
// chase, stock to reorder, bills and suppliers to pay, pay-small-small payments that are late, goods about to expire.
import { daysBetween, today } from '@/lib/dates';
import { overdueContacts } from './credit';
import { isLow, stockLevels } from './stock';
import { cashPlan } from './bills';
import { expiring } from './expiry';
import { openPlans, progress } from './layaway';
import type { Book } from './book';

export interface Todo { kind: 'chase' | 'reorder' | 'bill' | 'supplier' | 'layaway' | 'expiry' | 'alerts'; key: string; to: string; params: Record<string, string | number>; urgent: boolean }

export function todayList(book: Book, opts: { unseenAlerts?: number; bills?: boolean } = {}, now = today()): Todo[] {
  const out: Todo[] = [];
  if (opts.unseenAlerts) out.push({ kind: 'alerts', key: 'alerts', to: '/watch', params: { n: opts.unseenAlerts }, urgent: true });
  // Debts to chase: the biggest overdue first.
  for (const o of overdueContacts(book, now).sort((a, b) => b.balance - a.balance).slice(0, 3)) {
    out.push({ kind: 'chase', key: `chase-${o.contact.id}`, to: `/credit/${o.contact.id}`, params: { name: o.contact.name, amount: o.balance, days: daysBetween(o.since, now) }, urgent: daysBetween(o.since, now) > 7 });
  }
  // Stock to reorder.
  const levels = stockLevels(book);
  const low = book.products.filter((p) => !p.deleted && isLow(p, levels.get(p.id) ?? 0));
  if (low.length) out.push({ kind: 'reorder', key: 'reorder', to: '/stock', params: { n: low.length, names: low.slice(0, 3).map((p) => p.name).join(', ') }, urgent: low.some((p) => (levels.get(p.id) ?? 0) <= 0) });
  // Bills and suppliers due in the next 3 days (or late).
  if (opts.bills !== false) {
    const plan = cashPlan(book, 3, now);
    for (const d of plan.dues.slice(0, 3)) out.push({ kind: 'bill', key: `bill-${d.bill.id}-${d.due}`, to: '/bills', params: { name: d.bill.name, amount: d.bill.amount, days: daysBetween(now, d.due) }, urgent: d.late || d.due <= now });
    for (const s of plan.suppliers.slice(0, 2)) out.push({ kind: 'supplier', key: `sup-${s.contact.id}`, to: `/credit/${s.contact.id}`, params: { name: s.contact.name, amount: s.owed }, urgent: s.late });
  }
  // Pay small-small: late payments to ask for.
  for (const plan of openPlans(book)) {
    const p = progress(book, plan, now);
    if (!p.late) continue;
    const c = book.contacts.find((x) => x.id === plan.contact_id);
    out.push({ kind: 'layaway', key: `lay-${plan.id}`, to: '/layaway', params: { name: c?.name ?? '', item: plan.item, amount: p.left }, urgent: false });
  }
  // Goods expiring within a week.
  const soon = expiring(book, 7, now);
  if (soon.length) out.push({ kind: 'expiry', key: 'expiry', to: '/stock', params: { n: soon.length, names: soon.slice(0, 3).map((x) => x.product.name).join(', ') }, urgent: soon.some((x) => x.expired) });
  // Most urgent first, at most 8 so it stays a short list.
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent)).slice(0, 8);
}

/** Items ticked off today are hidden until tomorrow (kept on this phone). */
export const doneKey = (orgId: string, now = today()) => `todoDone:${orgId}:${now}`;
