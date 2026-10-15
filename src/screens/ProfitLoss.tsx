// Profit & loss statement screen (Health → Profit & loss, More, Cash book). Shareable as a PDF.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Seg, useDate } from '@/ui/widgets';
import { ActionButton } from '@/ui/extras';
import { formatMoney } from '@/lib/money';
import { today, addDays, monthStart } from '@/lib/dates';
import { shareFile } from '@/lib/share';
import { pnl } from '@/domain/pnl';

type Period = 'month' | 'last' | 'quarter' | 'year';

export function periodRange(p: Period, now = today()): [string, string] {
  if (p === 'month') return [monthStart(now), now];
  if (p === 'last') { const end = addDays(monthStart(now), -1); return [monthStart(end), end]; }
  if (p === 'quarter') return [addDays(now, -89), now];
  return [`${now.slice(0, 4)}-01-01`, now];
}

export function ProfitLoss() {
  const { t, i18n } = useTranslation();
  const book = useBook();
  const { fail } = useOverlay();
  const { fmt } = useDate();
  const [period, setPeriod] = useState<Period>('month');
  const [from, to] = periodRange(period);
  const p = pnl(book, from, to);
  const m = (v: number) => formatMoney(v);
  const row = (label: string, value: number, cls = '', sub?: string) => (
    <tr className={cls}><td>{label}{sub && <div className="small muted">{sub}</div>}</td><td className="r">{m(value)}</td></tr>
  );
  return (
    <Page title={t('pnl.title')} sub={t('pnl.sub')} back="/health">
      <Seg value={period} onChange={setPeriod} options={[['month', t('pnl.month')], ['last', t('pnl.last')], ['quarter', t('pnl.quarter')], ['year', t('pnl.year')]]} />
      <div className="card doc" data-testid="pnl">
        <h2>{book.org.name}</h2>
        <div className="small">{t('pnl.title')} · {fmt(from)} – {fmt(to)}</div>
        <table>
          <tbody>
            {row(t('pnl.revenue'), p.revenue, '', t('pnl.revenueHelp', { count: p.salesCount }))}
            {row(t('pnl.cogs'), -p.cogs, '', t('pnl.cogsHelp'))}
            {row(t('pnl.gross'), p.gross, 'tot', `${p.grossMargin}%`)}
            {p.expenses.map((e) => row(t(`categories.${e.category}`, { defaultValue: e.category }), -e.amount))}
            {row(t('pnl.operating'), -p.operating, 'sub-tot')}
            {row(t('pnl.net'), p.net, 'tot', `${p.netMargin}%`)}
          </tbody>
        </table>
        <div className="small muted">{t('pnl.stockNote', { amount: m(p.stockBought) })}</div>
        {p.tax > 0 && <div className="small muted">{t('tax.collected')}: {m(p.tax)}</div>}
        {!p.cogsKnown && <div className="alert small">{t('pnl.cogsWarn')}</div>}
      </div>
      <ActionButton icon="download" label={t('export.pdf')} className="btn primary block" testId="pnl-pdf" run={async () => {
        try {
          const { pnlPdf } = await import('@/features/pdf');
          await shareFile(pnlPdf(book, from, to, t, i18n.language === 'fr' ? 'fr-FR' : 'en-GB'), `kopor-profit-loss-${from}-${to}.pdf`, t('pnl.title'));
        } catch (e) { fail(e); }
      }} />
    </Page>
  );
}
