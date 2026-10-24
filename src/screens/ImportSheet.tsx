// Import customers or stock: from the phone's contacts, a spreadsheet / contacts file, or a photo of a notebook page.
// Shows every row to check (and untick) before anything is saved.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { formatMoney } from '@/lib/money';
import { findByName } from '@/domain/book';
import { customersFromTable, importCustomers, importProducts, parseVcf, productsFromTable, readTable, type CustomerRow, type ProductRow } from '@/domain/importer';

type Kind = 'customers' | 'products';
type Row = (CustomerRow | ProductRow) & { on: boolean; exists: boolean };
interface ContactPicker { select(props: string[], opts: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[] }[]> }
const picker = () => (navigator as Navigator & { contacts?: ContactPicker }).contacts;

export function ImportSheet({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const mark = (list: (CustomerRow | ProductRow)[]): Row[] =>
    list.map((r) => { const exists = !!findByName<{ name: string }>(kind === 'customers' ? book.contacts : book.products, r.name); return { ...r, exists, on: !exists }; });
  const load = async (fn: () => Promise<(CustomerRow | ProductRow)[]>) => {
    try { setBusy(true); const list = await fn(); if (!list.length) throw new Error(t('imp.nothing')); setRows(mark(list)); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const fromContacts = () => load(async () => {
    const got = await picker()!.select(['name', 'tel'], { multiple: true });
    return got.map((c) => ({ name: (c.name?.[0] ?? '').trim(), phone: (c.tel?.[0] ?? '').replace(/[^\d+]/g, ''), owes: 0 })).filter((c) => c.name);
  });
  const fromFile = (file?: File) => file && load(async () => {
    const r = await readTable(file);
    if (r.vcf) return parseVcf(r.text ?? '');
    return kind === 'customers' ? customersFromTable(r.rows) : productsFromTable(r.rows);
  });
  // A notebook page: the receipt reader turns each line into a name, a quantity and a price.
  const fromPhoto = (file?: File) => file && load(async () => {
    const { toDataUrl } = await import('@/lib/image');
    const url = await toDataUrl(file, 1600);
    let items: { name: string; qty: number; price: number }[] = [];
    try { items = (await (await import('@/ai/assistant')).scanReceipt(url, [])).items; }
    catch { const o = await import('@/ai/ocrReceipt'); items = o.parseReceiptText(await o.ocrImage(url)).items; }
    return kind === 'customers'
      ? items.map((i) => ({ name: i.name, phone: '', owes: Math.round(i.qty * i.price) }))
      : items.map((i) => ({ name: i.name, price: i.price, cost: 0, qty: i.qty || 0, low: 0, unit: 'pcs' }));
  });

  const save = async () => {
    const chosen = (rows ?? []).filter((r) => r.on);
    try {
      setBusy(true);
      if (kind === 'customers') {
        const r = await importCustomers(ctx, book, chosen as CustomerRow[]);
        toast(t('imp.doneCustomers', { count: r.added }), { view: '/credit' });
      } else {
        const r = await importProducts(ctx, book, chosen as ProductRow[]);
        toast(t('imp.doneProducts', { count: r.added }), { view: '/stock' });
      }
      closeSheet();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  if (rows) {
    const n = rows.filter((r) => r.on).length;
    return (
      <div className="stack" data-testid="import-review">
        <div className="small muted">{t('imp.check')}</div>
        <div className="list">
          {rows.map((r, i) => (
            <label key={i} className="item" style={{ opacity: r.exists ? 0.6 : 1 }}>
              <input type="checkbox" aria-label={r.name} checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <div className="main">
                <div className="t with-badge"><span className="trunc">{r.name}</span>{r.exists && <span className="badge">{t('imp.exists')}</span>}</div>
                <div className="s">{'owes' in r
                  ? [r.phone, r.owes ? t('imp.owes', { amount: formatMoney(r.owes) }) : ''].filter(Boolean).join(' · ') || '—'
                  : [r.price ? t('imp.price', { amount: formatMoney(r.price) }) : '', r.qty ? t('imp.qty', { n: r.qty, unit: r.unit }) : ''].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            </label>
          ))}
        </div>
        <button type="button" className="btn primary block" data-testid="import-save" disabled={busy || !n} onClick={save}><Icon name="check" size={18} /> {t('imp.save', { n })}</button>
        <button type="button" className="btn ghost block" onClick={() => setRows(null)}>{t('common.back')}</button>
      </div>
    );
  }
  return (
    <div className="stack" data-testid="import-sheet">
      <div className="small muted">{t(kind === 'customers' ? 'imp.helpCustomers' : 'imp.helpProducts')}</div>
      {kind === 'customers' && picker() && (
        <button type="button" className="btn primary block" disabled={busy} onClick={fromContacts}><Icon name="contact" size={18} /> {t('imp.contacts')}</button>
      )}
      <label className="btn block"><Icon name="upload" size={18} /> {t('imp.file')}
        <input type="file" hidden data-testid="import-file" accept=".xlsx,.xls,.csv,.ods,.vcf,text/csv,text/vcard" onChange={(e) => fromFile(e.target.files?.[0])} />
      </label>
      <label className="btn block"><Icon name="camera" size={18} /> {t('imp.photo')}
        <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => fromPhoto(e.target.files?.[0])} />
      </label>
      {busy && <div className="small muted" role="status">{t('common.loading')}</div>}
      <div className="small muted">{t(kind === 'customers' ? 'imp.columnsCustomers' : 'imp.columnsProducts')}</div>
    </div>
  );
}
