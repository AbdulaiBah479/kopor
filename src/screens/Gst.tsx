// Monthly GST report for the NRA: what to copy into the GST return, as text to share or an Excel file to keep.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { shareFile, shareText } from '@/lib/share';
import { today } from '@/lib/dates';
import { gstMonth, type GstMonth } from '@/domain/gst';

const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

export function Gst() {
  const { t } = useTranslation();
  const book = useBook();
  const { fail } = useOverlay();
  const [month, setMonth] = useState(prevMonth());
  const [estimate, setEstimate] = useState(false);
  const g = gstMonth(book, month, { estimateInput: estimate });
  const rows: [string, number, string?][] = [
    [t('gst.taxableSales'), g.taxableSales, t('gst.taxableHelp', { count: g.taxedCount })],
    [t('gst.outputTax', { rate: g.rate }), g.outputTax],
    [t('gst.otherSales'), g.otherSales, t('gst.otherHelp')],
    [t('gst.purchases'), g.purchasesTotal, t('gst.purchasesHelp')],
    [t('gst.inputTax'), g.inputTax, estimate ? t('gst.estimated') : t('gst.notCounted')],
  ];
  const text = () => [
    t('gst.textTitle', { business: g.business, month }), g.tin ? `TIN: ${g.tin}` : '', `GST ${g.rate}%`, '',
    ...rows.map(([k, v]) => `${k}: ${formatMoney(v)}`), '', `${t(g.net >= 0 ? 'gst.toPay' : 'gst.credit')}: ${formatMoney(Math.abs(g.net))}`,
  ].filter((l, i, a) => l || a[i - 1]).join('\n');
  const excel = async () => {
    try { const blob = await gstWorkbook(g, t); await shareFile(blob, `kopor-gst-${month}.xlsx`, t('gst.title')); } catch (e) { fail(e); }
  };
  return (
    <Page title={t('gst.title')} sub={t('gst.sub')} back="/more">
      <Field label={t('gst.month')}><input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
      {!g.rate && <div className="alert"><Icon name="alert" /><div>{t('gst.off')} <Link to="/settings">{t('settings.title')}</Link></div></div>}
      <div className="card stack" data-testid="gst-report">
        <div className="row between"><b>{g.business}</b><span className="small muted">{g.tin ? `TIN ${g.tin}` : t('gst.noTin')}</span></div>
        <div className="list">
          {rows.map(([k, v, help]) => (
            <div key={k} className="item"><div className="main"><div className="t" style={{ whiteSpace: 'normal' }}>{k}</div>{help && <div className="s" style={{ whiteSpace: 'normal' }}>{help}</div>}</div><div className="amt num">{formatMoney(v)}</div></div>
          ))}
        </div>
        <div className="row between" style={{ fontSize: 18 }} data-testid="gst-net"><b>{t(g.net >= 0 ? 'gst.toPay' : 'gst.credit')}</b><b className="num">{formatMoney(Math.abs(g.net))}</b></div>
        <label className="check"><input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} /> {t('gst.estimate')}</label>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => shareText(text())}><Icon name="share" size={18} /> {t('gst.share')}</button>
          <button type="button" className="btn" onClick={excel}><Icon name="download" size={18} /> Excel</button>
        </div>
      </div>
      <div className="card flat small muted">{t('gst.disclaimer')}</div>
    </Page>
  );
}

/** Summary sheet plus every sale, return and purchase of the month (amounts in Leones). */
async function gstWorkbook(g: GstMonth, t: (k: string, o?: Record<string, unknown>) => string): Promise<Blob> {
  const XLSX = await import('xlsx');
  const major = (m: number) => Math.round(m) / 100;
  const wb = XLSX.utils.book_new();
  const summary = [
    [t('gst.title'), g.business], ['TIN', g.tin], [t('gst.month'), g.month], ['GST %', g.rate], [],
    [t('gst.taxableSales'), major(g.taxableSales)], [t('gst.outputTax', { rate: g.rate }), major(g.outputTax)], [t('gst.otherSales'), major(g.otherSales)],
    [t('gst.purchases'), major(g.purchasesTotal)], [t('gst.inputTax'), major(g.inputTax)], [t(g.net >= 0 ? 'gst.toPay' : 'gst.credit'), major(Math.abs(g.net))],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'GST');
  const line = (x: GstMonth['lines']['sales'][number]) => ({ date: x.date, note: x.note || x.items.map((i) => `${i.qty} ${i.name}`).join(', '), method: x.method, net: major(x.amount - (x.tax ?? 0)), gst: major(x.tax ?? 0), total: major(x.amount) });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(g.lines.sales.map(line)), 'Sales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(g.lines.refunds.map(line)), 'Returns');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(g.lines.purchases.map((x) => ({ date: x.date, category: x.category, note: x.note, amount: major(x.amount) }))), 'Purchases');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
