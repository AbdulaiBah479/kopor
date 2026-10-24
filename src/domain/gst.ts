// Monthly GST summary for the National Revenue Authority (Sierra Leone GST, normally 15%): GST charged on sales
// (output tax), an optional estimate of GST paid on business purchases (input tax), and the difference to pay.
// Kopor records GST on every sale when tax is switched on (Settings → Tax & receipts). Purchases do not carry their
// own GST figure, so input tax is only an estimate from the amounts paid (prices assumed to include GST).
import type { Txn } from '@/db/schema';
import { taxSettings } from './tax';
import type { Book } from './book';

/** Business costs on which GST may have been paid (not salaries, taxes, loan repayments or food). */
export const INPUT_CATEGORIES = ['stock', 'rent', 'transport', 'utilities', 'phone', 'fuel', 'repairs', 'other'];

export function gstMonth(book: Book, month: string, opts: { estimateInput?: boolean } = {}) {
  const rate = taxSettings(book.org).rate;
  const inMonth = (t: Txn) => t.date.startsWith(month);
  const sales = book.txns.filter((t) => inMonth(t) && t.type === 'in');
  const refunds = book.txns.filter((t) => inMonth(t) && t.type === 'out' && t.category === 'refund');
  const purchases = book.txns.filter((t) => inMonth(t) && t.type === 'out' && INPUT_CATEGORIES.includes(t.category));

  const taxed = sales.filter((t) => (t.tax ?? 0) > 0), untaxed = sales.filter((t) => !(t.tax ?? 0));
  const sum = (rows: Txn[], f: (t: Txn) => number) => rows.reduce((s, t) => s + f(t), 0);
  const taxableSales = sum(taxed, (t) => t.amount - (t.tax ?? 0)) - sum(refunds.filter((r) => (r.tax ?? 0) > 0), (r) => r.amount - (r.tax ?? 0));
  const outputTax = sum(taxed, (t) => t.tax ?? 0) - sum(refunds, (r) => r.tax ?? 0);
  const otherSales = sum(untaxed, (t) => t.amount) - sum(refunds.filter((r) => !(r.tax ?? 0)), (r) => r.amount);
  const purchasesTotal = sum(purchases, (t) => t.amount);
  const inputTax = opts.estimateInput && rate > 0 ? Math.round(purchasesTotal * rate / (100 + rate)) : 0;
  return {
    month, rate, tin: book.org.tax_id ?? '', business: book.org.name,
    taxableSales, outputTax, otherSales, refunds: sum(refunds, (r) => r.amount), salesCount: sales.length, taxedCount: taxed.length,
    purchasesTotal, inputTax, estimated: !!opts.estimateInput, net: outputTax - inputTax,
    lines: { sales, refunds, purchases },
  };
}
export type GstMonth = ReturnType<typeof gstMonth>;
