// Answers the most common business questions without internet or AI, straight from the records.
// Understands English and Krio (standard and phone spelling, via foldKrio).
import type { TFunction } from 'i18next';
import type { Book } from '@/domain/book';
import { formatMoney } from '@/lib/money';
import { today, addDays, monthStart } from '@/lib/dates';
import { summary, topProducts } from '@/domain/cash';
import { balances, creditTotals } from '@/domain/credit';
import { forecast, stockLevels } from '@/domain/stock';
import { foldKrio } from './parser';

export type OfflineIntent = 'debts' | 'restock' | 'profit' | 'expenses' | 'best';

const INTENTS: [OfflineIntent, RegExp][] = [
  ['debts', /owe|debt|det\b|collect|kolekt|udat.*(ow|pe)|who.*pay|credit|kredit|tros/],
  ['restock', /restock|stock|stok|buy|bay|run(ning)? out|finish|don\b|order/],
  ['expenses', /expens|ekspens|cost|kost|spen|spend|wetin.*kost/],
  ['best', /best|top|sel pas|sell(s|ing)? (the )?most|popular|wetin.*sel/],
  ['profit', /profit|how.*(business|doing)|aw.*biznes|sales|sel\b|month|mont|money|moni|gro|grow/],
];

export function detectIntent(question: string): OfflineIntent | null {
  const q = foldKrio(question);
  return INTENTS.find(([, re]) => re.test(q))?.[0] ?? null;
}

const join = (xs: string[]) => xs.join(', ');

export function answerOffline(question: string, book: Book, t: TFunction, now = today()): string {
  const intent = detectIntent(question);
  const m = (x: number) => formatMoney(x);
  switch (intent) {
    case 'debts': {
      const bal = balances(book.ledger);
      const top = book.contacts.map((c) => ({ n: c.name, b: bal.get(c.id) ?? 0 })).filter((x) => x.b > 0).sort((a, b) => b.b - a.b).slice(0, 5);
      return top.length ? t('off.debts', { list: join(top.map((x) => `${x.n} ${m(x.b)}`)), total: m(creditTotals(book).get) }) : t('off.noDebts');
    }
    case 'restock': {
      const levels = stockLevels(book);
      const low = book.products
        .map((p) => ({ p, left: levels.get(p.id) ?? 0, days: forecast(book, p.id, 14, now).daysLeft }))
        .filter((x) => x.left <= x.p.low_at || (x.days !== null && x.days <= 7))
        .sort((a, b) => (a.days ?? 99) - (b.days ?? 99)).slice(0, 6);
      return low.length ? t('off.restock', { list: join(low.map((x) => `${x.p.name} (${x.left} ${x.p.unit})`)) }) : t('off.noRestock');
    }
    case 'expenses': {
      const out = book.txns.filter((x) => x.type === 'out' && !x.deleted && x.date >= monthStart(now) && x.date <= now);
      const by = new Map<string, number>();
      out.forEach((x) => by.set(x.category, (by.get(x.category) ?? 0) + x.amount));
      const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 4);
      return top.length ? t('off.expenses', { list: join(top.map(([c, v]) => `${t(`categories.${c}`)} ${m(v)}`)) }) : t('off.noExpenses');
    }
    case 'best': {
      const top = topProducts(book, monthStart(now), now, 5);
      return top.length ? t('off.best', { list: join(top.map((p) => `${p.name} ×${p.qty}`)) }) : t('off.noBest');
    }
    case 'profit': {
      const s = summary(book, addDays(now, -29), now), prev = summary(book, addDays(now, -59), addDays(now, -30));
      return t('off.profit', { sales: m(s.sales), expenses: m(s.expenses), profit: m(s.profit), prev: m(prev.sales) });
    }
    default: return t('off.help');
  }
}
