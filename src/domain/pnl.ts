// Profit & loss statement (accrual style, as banks and accountants expect):
//   Revenue (sales net of tax and refunds)
// − Cost of goods sold (buying price of the items actually sold)
// = Gross profit
// − Operating expenses (rent, transport, salaries, …; buying stock is NOT an expense here: it becomes cost when sold)
// = Net profit
import type { Book } from './book';
import { summary } from './cash';

export interface Pnl {
  revenue: number; cogs: number; gross: number; grossMargin: number;
  expenses: { category: string; amount: number }[]; operating: number; net: number; netMargin: number;
  stockBought: number; tax: number; refunds: number; discounts: number; salesCount: number; cogsKnown: boolean;
}

export function pnl(book: Book, from: string, to: string): Pnl {
  const s = summary(book, from, to);
  const by = new Map<string, number>();
  let stockBought = 0, salesCount = 0, itemSales = 0, plainSales = 0;
  for (const t of book.txns) {
    if (t.date < from || t.date > to) continue;
    if (t.type === 'in') { salesCount++; if (t.items.length) itemSales++; else plainSales++; continue; }
    if (t.category === 'refund') continue;
    if (t.category === 'stock') { stockBought += t.amount; continue; }
    by.set(t.category, (by.get(t.category) ?? 0) + t.amount);
  }
  const expenses = [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const operating = expenses.reduce((a, e) => a + e.amount, 0);
  const gross = s.sales - s.cogs, net = gross - operating;
  const pct = (v: number) => (s.sales ? Math.round((v / s.sales) * 100) : 0);
  return {
    revenue: s.sales, cogs: s.cogs, gross, grossMargin: pct(gross), expenses, operating, net, netMargin: pct(net),
    stockBought, tax: s.tax, refunds: s.refunds, discounts: s.discounts, salesCount,
    // Cost of goods is only known for sales recorded with products; typed-in amounts have no buying price.
    cogsKnown: plainSales === 0 || itemSales > 0 && plainSales / Math.max(1, salesCount) < 0.5,
  };
}
