// Season-smart restocking: the big shopping dates in Sierra Leone, and what this shop sold more of last year in the
// two weeks before each one. Works only from the shop's own records (offline, no AI). Nothing is shown until there
// is a year of history, because guesses without data would be worse than nothing.
import { addDays, daysBetween } from '@/lib/dates';
import { stockLevels } from './stock';
import type { Book } from './book';

export type SeasonKey = 'christmas' | 'newyear' | 'easter' | 'independence' | 'school' | 'ramadan' | 'eidFitr' | 'eidAdha';
export interface SeasonEvent { key: SeasonKey; date: string }

// Islamic holidays follow the moon, so their dates move about 11 days earlier each year (may differ by a day locally).
const EID_FITR: Record<number, string> = { 2024: '04-10', 2025: '03-30', 2026: '03-20', 2027: '03-09', 2028: '02-26', 2029: '02-14', 2030: '02-04', 2031: '01-24', 2032: '01-14' };
const EID_ADHA: Record<number, string> = { 2024: '06-16', 2025: '06-06', 2026: '05-27', 2027: '05-16', 2028: '05-05', 2029: '04-24', 2030: '04-13', 2031: '04-02', 2032: '03-22' };

/** Easter Sunday (Gregorian, anonymous algorithm). */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The second Monday of September: schools reopen around then. */
function schoolStart(y: number): string {
  const first = new Date(y, 8, 1).getDay(); // 0 Sunday
  const firstMonday = 1 + ((8 - first) % 7);
  return `${y}-09-${String(firstMonday + 7).padStart(2, '0')}`;
}

export function eventsOf(year: number): SeasonEvent[] {
  const out: SeasonEvent[] = [
    { key: 'newyear', date: `${year}-01-01` }, { key: 'independence', date: `${year}-04-27` }, { key: 'easter', date: easter(year) },
    { key: 'school', date: schoolStart(year) }, { key: 'christmas', date: `${year}-12-25` },
  ];
  if (EID_FITR[year]) { out.push({ key: 'eidFitr', date: `${year}-${EID_FITR[year]}` }, { key: 'ramadan', date: addDays(`${year}-${EID_FITR[year]}`, -29) }); }
  if (EID_ADHA[year]) out.push({ key: 'eidAdha', date: `${year}-${EID_ADHA[year]}` });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Big dates coming within `days` (default three weeks). */
export function upcoming(now: string, days = 21): SeasonEvent[] {
  const y = Number(now.slice(0, 4));
  return [...eventsOf(y), ...eventsOf(y + 1)].filter((e) => e.date > now && daysBetween(now, e.date) <= days);
}

/** Pieces of each product sold between two dates (inclusive). */
function soldBetween(book: Book, from: string, to: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of book.txns) {
    if (t.type !== 'in' || t.date < from || t.date > to) continue;
    for (const i of t.items) if (i.product_id) m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.qty * (i.per ?? 1));
  }
  return m;
}

export interface SeasonTip { event: SeasonEvent; days: number; product: { id: string; name: string; unit: string }; times: number; need: number; have: number; buy: number }

/**
 * For each big date in the next three weeks: products that sold at least 1.3× their usual rate in the two weeks before
 * the same date last year, how many will likely be needed until the day, and how many to buy.
 */
export function seasonPlan(book: Book, now: string): SeasonTip[] {
  const levels = stockLevels(book);
  const recent = soldBetween(book, addDays(now, -28), now);              // this year's usual rate: the last 4 weeks
  const tips: SeasonTip[] = [];
  for (const event of upcoming(now)) {
    const last = eventsOf(Number(event.date.slice(0, 4)) - 1).find((e) => e.key === event.key);
    if (!last) continue;
    const before = soldBetween(book, addDays(last.date, -14), addDays(last.date, -1));     // 2 weeks before, last year
    const usual = soldBetween(book, addDays(last.date, -70), addDays(last.date, -15));     // the 8 weeks before that
    const days = daysBetween(now, event.date);
    for (const p of book.products) {
      const b = before.get(p.id) ?? 0, u = (usual.get(p.id) ?? 0) / 4;                      // u = usual sales per 2 weeks
      if (b < 3 || u < 1) continue;
      const times = b / u;
      if (times < 1.3) continue;
      const perDay = (recent.get(p.id) ?? 0) / 28 || u / 14;
      const need = Math.ceil(perDay * Math.min(days, 14) * times + perDay * Math.max(0, days - 14));
      const have = Math.max(0, levels.get(p.id) ?? 0);
      tips.push({ event, days, product: { id: p.id, name: p.name, unit: p.unit }, times: Math.round(times * 10) / 10, need, have, buy: Math.max(0, need - have) });
    }
  }
  return tips.sort((a, b) => a.days - b.days || b.buy - a.buy);
}
