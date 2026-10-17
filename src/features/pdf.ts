// Real PDF documents (invoice/receipt and loan report) with jsPDF + jspdf-autotable. Loaded on demand.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Invoice } from '@/db/schema';
import type { Book } from '@/domain/book';
import { formatMoney } from '@/lib/money';
import { fmtDate, fmtMonth, today, addDays } from '@/lib/dates';
import { refCode } from '@/lib/crypto';
import { latinSafe } from '@/lib/text';
import { itemsTotal, summary, topProducts } from '@/domain/cash';
import { invoiceCode, invoiceTotal, docKind, isQuote } from '@/domain/invoices';
import { health, monthlySeries } from '@/domain/health';
import { creditTotals } from '@/domain/credit';
import { stockValue } from '@/domain/stock';
import { pnl } from '@/domain/pnl';

type T = (key: string, opts?: Record<string, unknown>) => string;

const pdfSafe = latinSafe;

const GREEN: [number, number, number] = [4, 120, 87]; // Kopor emerald #047857
const m = (v: number) => pdfSafe(formatMoney(v));

function header(doc: jsPDF, book: Book, title: string, sub: string) {
  const o = book.org;
  doc.setTextColor(...GREEN).setFont('helvetica', 'bold').setFontSize(18).text(pdfSafe(o.name), 14, 20);
  doc.setTextColor(60).setFont('helvetica', 'normal').setFontSize(9);
  const lines = [o.address, o.phone, o.tax_id ? `TIN: ${o.tax_id}` : ''].filter(Boolean).map((x) => pdfSafe(x!));
  doc.text(lines, 14, 26);
  doc.setTextColor(20).setFont('helvetica', 'bold').setFontSize(14).text(pdfSafe(title), 196, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).text(pdfSafe(sub), 196, 26, { align: 'right' });
}

export function invoicePdf(book: Book, inv: Invoice, t: T, loc: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const paid = inv.status === 'paid';
  const quote = isQuote(inv);
  header(doc, book, t(docKind(inv)), inv.number);
  doc.setFontSize(9).setTextColor(90).text(pdfSafe(t('inv.billTo')), 14, 44);
  doc.setFontSize(11).setTextColor(20).setFont('helvetica', 'bold').text(pdfSafe(inv.customer), 14, 50);
  doc.setFont('helvetica', 'normal').setFontSize(9);
  const dates = [`${t('common.date')}: ${fmtDate(inv.date, loc)}`];
  if (paid) dates.push(`${t('inv.paidOn')}: ${fmtDate(inv.paid_date, loc)}`); else if (inv.due_date) dates.push(`${t(quote ? 'quote.validUntil' : 'inv.due')}: ${fmtDate(inv.due_date, loc)}`);
  doc.text(dates.map(pdfSafe), 196, 44, { align: 'right' });

  const sub = itemsTotal(inv.items), total = invoiceTotal(inv);
  const foot: string[][] = [];
  if (inv.discount || inv.tax) foot.push(['', '', pdfSafe(t('tax.subtotal')), m(sub)]);
  if (inv.discount) foot.push(['', '', pdfSafe(t('tax.discount')), `-${m(inv.discount)}`]);
  if (inv.tax) foot.push(['', '', pdfSafe(`${t('tax.tax')}${book.org.tax_inclusive ? ` (${t('tax.included')})` : ''}`), m(inv.tax)]);
  foot.push(['', '', pdfSafe(t('common.total')), m(total)]);
  autoTable(doc, {
    startY: 58,
    head: [[t('common.item'), t('common.qty'), t('common.price'), t('common.amount')].map(pdfSafe)],
    body: inv.items.map((i) => [pdfSafe(i.name), String(i.qty), m(i.price), m(i.qty * i.price)]),
    foot,
    theme: 'striped',
    headStyles: { fillColor: GREEN },
    footStyles: { fillColor: [245, 247, 244], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  doc.setFontSize(9).setTextColor(60);
  if (inv.notes) { doc.text(pdfSafe(inv.notes), 14, y); y += 6; }
  if (quote) { doc.text(pdfSafe(t('quote.notice')), 14, y); y += 6; }
  if (inv.status === 'unpaid' && book.org.momo_number) { doc.text(pdfSafe(`${t('inv.payMomo')}: ${book.org.momo_number}`), 14, y); y += 6; }
  if (book.org.receipt_footer) { doc.text(pdfSafe(book.org.receipt_footer), 14, y); y += 6; }
  doc.setDrawColor(200).line(14, y + 2, 196, y + 2);
  doc.setFontSize(8).text(pdfSafe(`${t('inv.verify')}: ${invoiceCode(book.org.name, inv)} · ${t('inv.generated')}`), 14, y + 8);
  if (paid) doc.setTextColor(...GREEN).setFont('helvetica', 'bold').setFontSize(28).text(pdfSafe(t('inv.paid').toUpperCase()), 150, 52, { angle: 12 });
  return doc.output('blob');
}

/** Profit & loss statement for a period (see domain/pnl.ts). */
export function pnlPdf(book: Book, from: string, to: string, t: T, loc: string): Blob {
  const p = pnl(book, from, to);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  header(doc, book, t('pnl.title'), `${fmtDate(from, loc)} - ${fmtDate(to, loc)}`);
  const body: [string, string][] = [
    [t('pnl.revenue'), m(p.revenue)],
    [t('pnl.cogs'), m(-p.cogs)],
    [`${t('pnl.gross')} (${p.grossMargin}%)`, m(p.gross)],
    ...p.expenses.map((e) => [t(`categories.${e.category}`), m(-e.amount)] as [string, string]),
    [t('pnl.operating'), m(-p.operating)],
  ];
  autoTable(doc, {
    startY: 40, body: body.map(([a, b]) => [pdfSafe(a), b]),
    foot: [[pdfSafe(`${t('pnl.net')} (${p.netMargin}%)`), m(p.net)]],
    footStyles: { fillColor: GREEN, textColor: 255 }, columnStyles: { 1: { halign: 'right' } }, theme: 'striped',
  });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(9).setTextColor(60).text(doc.splitTextToSize(pdfSafe(t('pnl.stockNote', { amount: formatMoney(p.stockBought) })), 182), 14, y);
  y += 10;
  const code = refCode([book.org.id, from, to, p.revenue, p.net].join('|'));
  doc.setFontSize(8).text(pdfSafe(`${t('inv.verify')}: ${code} · ${t('inv.generated')}`), 14, y);
  return doc.output('blob');
}

export function reportPdf(book: Book, t: T, loc: string): Blob {
  const now = today(), from = addDays(now, -89);
  const h = health(book, now), q = summary(book, from, now), credit = creditTotals(book);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  header(doc, book, t('health.reportTitle'), `${fmtDate(from, loc)} - ${fmtDate(now, loc)}`);
  autoTable(doc, {
    startY: 40,
    head: [[t('health.month'), t('cash.sales'), t('cash.expenses'), t('cash.profit')].map(pdfSafe)],
    body: monthlySeries(book, 3, now).map((r) => [pdfSafe(fmtMonth(r.month, loc)), m(r.sales), m(r.expenses), m(r.profit)]),
    foot: [[pdfSafe(t('health.last90')), m(q.sales), m(q.expenses), m(q.profit)]],
    headStyles: { fillColor: GREEN }, footStyles: { fillColor: [245, 247, 244], textColor: 20 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  const rows: [string, string][] = [
    [t('health.avgSales'), m(Math.round(q.sales / 3))],
    [t('health.margin'), `${q.sales ? Math.round((q.profit / q.sales) * 100) : 0}%`],
    [t('tax.collected'), m(q.tax)],
    [t('health.owedToBiz'), m(credit.get)],
    [t('health.owedBySupp'), m(credit.give)],
    [t('health.stockValue'), m(stockValue(book))],
    [t('health.txCount'), String(q.count)],
    [t('health.activeDays'), String(h.activeDays)],
    [t('health.score'), `${h.score}/100 (${t(`health.labels.${h.label}`)})`],
  ];
  autoTable(doc, { body: rows.map(([a, b]) => [pdfSafe(a), pdfSafe(b)]), theme: 'plain', columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } } });
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  const top = topProducts(book, from, now, 5);
  doc.setFontSize(9).setTextColor(60);
  if (top.length) { doc.text(pdfSafe(`${t('health.topProducts')}: ${top.map((p) => p.name).join(', ')}`), 14, y); y += 8; }
  const code = refCode([book.org.id, now, q.sales, q.expenses, h.score].join('|'));
  doc.setFontSize(8).text(doc.splitTextToSize(pdfSafe(t('health.disclaimer', { date: fmtDate(now, loc), code })), 182), 14, y);
  return doc.output('blob');
}
