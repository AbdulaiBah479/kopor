// One search box for the whole business: customers and suppliers, products, invoices, groups, sales and the app's own
// screens. Every word typed must appear (in any order, ignoring case and accents); a number also finds amounts
// ("1500" finds a Le 1,500 sale) and phone numbers typed with or without spaces. Only the best few per kind are
// returned, so it stays instant even with thousands of records.
import type { Book } from './book';
import { itemsLabel } from './cash';
import { invoiceTotal } from './invoices';

export type HitKind = 'contact' | 'product' | 'invoice' | 'group' | 'sale' | 'screen';
export interface Hit { kind: HitKind; id: string; title: string; sub: string; amount?: number; to: string }
export interface Screen { title: string; sub: string; to: string }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const digits = (s: string) => s.replace(/\D/g, '');

/** A matcher for what was typed: every word must be in the text; numbers may also match an amount or a phone. */
export function matcher(query: string) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const num = /^\d[\d,. ]*$/.test(query.trim()) ? Number(query.replace(/[, ]/g, '')) : NaN;
  return (text: string, amount?: number, phone?: string) => {
    if (!words.length) return false;
    if (!Number.isNaN(num) && amount !== undefined && Math.round(num * 100) === amount) return true;
    if (phone && words.length === 1 && digits(words[0]!).length >= 4 && digits(phone).includes(digits(words[0]!))) return true;
    const hay = norm(text);
    return words.every((w) => hay.includes(w));
  };
}

export function searchBook(book: Book, query: string, screens: Screen[] = [], limit = 6): Hit[] {
  const m = matcher(query);
  const out: Hit[] = [];
  const take = <T,>(list: T[], ok: (x: T) => boolean, hit: (x: T) => Hit) => {
    let n = 0;
    for (const x of list) { if (n >= limit) break; if (ok(x)) { out.push(hit(x)); n++; } }
  };
  take(screens, (s) => m(`${s.title} ${s.sub}`), (s) => ({ kind: 'screen', id: s.to, title: s.title, sub: s.sub, to: s.to }));
  take(book.contacts, (c) => !c.deleted && m(`${c.name} ${c.phone} ${c.notes}`, undefined, c.phone),
    (c) => ({ kind: 'contact', id: c.id, title: c.name, sub: c.phone, to: `/credit/${c.id}` }));
  take(book.products, (p) => !p.deleted && m(`${p.name} ${p.sku}`, p.price),
    (p) => ({ kind: 'product', id: p.id, title: p.name, sub: p.sku, amount: p.price, to: '/stock' }));
  take([...book.invoices].sort((a, b) => b.date.localeCompare(a.date)), (i) => !i.deleted && m(`${i.number} ${i.customer} ${i.phone} ${itemsLabel(i.items)}`, invoiceTotal(i), i.phone),
    (i) => ({ kind: 'invoice', id: i.id, title: `${i.number} · ${i.customer}`, sub: i.date, amount: invoiceTotal(i), to: `/invoices/${i.id}` }));
  take(book.groups, (g) => !g.deleted && m(g.name), (g) => ({ kind: 'group', id: g.id, title: g.name, sub: '', to: `/groups/${g.id}` }));
  // Sales, newest first (the last 2,000 are plenty to find "that sale last week").
  const names = new Map(book.contacts.map((c) => [c.id, c.name]));
  const sales = book.txns.filter((x) => x.type === 'in' && !x.deleted).sort((a, b) => b.created_at - a.created_at).slice(0, 2000);
  take(sales, (x) => m(`${itemsLabel(x.items)} ${x.note} ${x.contact_id ? names.get(x.contact_id) ?? '' : ''}`, x.amount),
    (x) => ({ kind: 'sale', id: x.id, title: itemsLabel(x.items) || x.note || (x.contact_id ? names.get(x.contact_id) ?? '' : ''), sub: x.date, amount: x.amount, to: '/cash' }));
  return out;
}
