// Excel export of the whole business with SheetJS (opens in Excel, Google Sheets, LibreOffice). Loaded on demand.
import * as XLSX from 'xlsx';
import type { Book } from '@/domain/book';
import { balances } from '@/domain/credit';
import { stockLevels } from '@/domain/stock';
import { invoiceTotal } from '@/domain/invoices';
import { itemsLabel } from '@/domain/cash';

const major = (minor: number | undefined) => Math.round(minor ?? 0) / 100;

export function businessWorkbook(book: Book, t: (k: string) => string): Blob {
  const name = (id: string | null) => book.contacts.find((c) => c.id === id)?.name ?? '';
  const bal = balances(book.ledger);
  const levels = stockLevels(book);
  const sheets: [string, Record<string, unknown>[]][] = [
    [t('cash.title'), [...book.txns].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({
      [t('common.date')]: x.date, [t('common.type')]: x.type === 'in' ? t('cash.sales') : x.category === 'refund' ? t('returns.refund') : t('cash.expenses'),
      [t('cash.category')]: t(`categories.${x.category}`), [t('cash.method')]: t(`methods.${x.method}`), [t('common.name')]: name(x.contact_id),
      [t('common.items')]: itemsLabel(x.items), [t('tax.discount')]: major(x.discount), [t('tax.tax')]: major(x.tax), [t('common.amount')]: major(x.amount), [t('common.note')]: x.note,
    }))],
    [t('credit.title'), [...book.ledger].sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({
      [t('common.date')]: e.date, [t('common.name')]: name(e.contact_id), [t('common.type')]: e.type === 'gave' ? t('credit.youGave') : t('credit.youGot'),
      [t('common.amount')]: major(e.amount), [t('common.dueDate')]: e.due_date ?? '', [t('common.note')]: e.note,
    }))],
    [t('credit.customer'), book.contacts.map((c) => ({
      [t('common.name')]: c.name, [t('common.phone')]: c.phone, [t('credit.kind')]: t(`credit.${c.kind}`), [t('credit.balance')]: major(bal.get(c.id)),
    }))],
    [t('stock.title'), book.products.map((p) => ({
      [t('stock.product')]: p.name, [t('stock.sku')]: p.sku, [t('stock.unit')]: p.unit, [t('stock.qty')]: levels.get(p.id) ?? 0,
      [t('stock.sell')]: major(p.price), [t('stock.cost')]: major(p.cost), [t('stock.value')]: major(Math.max(0, levels.get(p.id) ?? 0) * (p.cost || p.price)),
    }))],
    [t('inv.title').slice(0, 30), book.invoices.map((i) => ({
      '#': i.number, [t('common.date')]: i.date, [t('inv.customer')]: i.customer, [t('common.status')]: t(`inv.${i.status}`), [t('common.total')]: major(invoiceTotal(i)),
    }))],
    [t('groups.title').slice(0, 30), book.contributions.map((c) => {
      const g = book.groups.find((x) => x.id === c.group_id);
      return { [t('groups.name')]: g?.name ?? '', [t('common.name')]: g?.members.find((m) => m.id === c.member_id)?.name ?? '', [t('export.roundCol')]: c.round, [t('common.amount')]: major(c.amount), [t('common.date')]: c.date };
    })],
    [t('closing.title').slice(0, 30), book.closings.map((c) => ({
      [t('common.date')]: c.date, [t('closing.expected')]: major(c.expected), [t('closing.counted')]: major(c.counted), [t('closing.difference')]: major(c.difference), [t('common.note')]: c.note,
    }))],
  ];
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const [title, rows] of sheets) {
    let n = title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
    while (used.has(n)) n = `${n.slice(0, 28)} ${used.size}`;
    used.add(n);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), n);
  }
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
