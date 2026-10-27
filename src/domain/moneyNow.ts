// "Money now" on Home: cash that should be in the drawer, mobile money that came in today per network, what customers
// owe, what the business owes, and the stock on the shelves at buying price.
import type { Book } from './book';
import { cashSinceLastCount, expectedMomo, MOMO } from './closing';
import { creditTotals } from './credit';
import { stockValue } from './stock';
import { today } from '@/lib/dates';

export function moneyNow(book: Book, date = today()) {
  const cash = cashSinceLastCount(book, date);
  const momo = expectedMomo(book, date);
  const { get, give } = creditTotals(book);
  return {
    drawer: cash.expected, since: cash.last?.created_at ?? null,
    momo: MOMO.map((k) => [k, momo[k] ?? 0] as const).filter(([, v]) => v !== 0),
    owedToYou: get, youOwe: give, stock: stockValue(book),
  };
}
