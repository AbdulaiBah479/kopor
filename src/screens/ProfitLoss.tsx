// Profit & loss statement screen (Health → Profit & loss, More, Cash book). Shareable as a PDF.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Seg, useDate } from '@/ui/widgets';
import { ActionButton } from '@/ui/extras';
import { formatMoney } from '@/lib/money';
import { today, addDays, monthStart, daysBetween } from '@/lib/dates';
import { Icon } from '@/ui/Icon';
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
  const { can } = useApp();
  const [why, setWhy] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  // "Explain my month": the AI gets the exact figures of this period and the same length before it, and explains in
  // plain words why profit moved and what to do. Only the numbers below are used, never invented ones.
  const explain = async () => {
    setThinking(true); setWhy(null);
    try {
      const len = daysBetween(from, to) + 1, pf = addDays(from, -len), pt = addDays(from, -1), q = pnl(book, pf, pt);
      const lines = (x: ReturnType<typeof pnl>) => `sales ${m(x.revenue)}, cost of goods ${m(x.cogs)}, gross margin ${x.grossMargin}%, spending ${m(x.operating)} (${x.expenses.slice(0, 4).map((e) => `${e.category} ${m(e.amount)}`).join(', ') || 'none'}), profit ${m(x.net)}, ${x.salesCount} sales`;
      const { askAssistant } = await import('@/ai/assistant');
      const answer = await askAssistant(t('pnl.explainAsk', { now: `${fmt(from)} – ${fmt(to)}: ${lines(p)}`, before: `${fmt(pf)} – ${fmt(pt)}: ${lines(q)}` }), [], book, i18n.language, { private: true });
      setWhy(answer.trim());
    } catch (e) { fail(e); } finally { setThinking(false); }
  };
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
      {can('reports') && (
        <div className="card stack no-print" data-testid="pnl-explain">
          <button type="button" className="btn tinted block" disabled={thinking} onClick={explain}><Icon name="spark" size={18} /> {thinking ? t('pnl.explaining') : t('pnl.explain')}</button>
          {why && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{why}</div>}
          {why && <div className="small muted">{t('pnl.explainNote')}</div>}
        </div>
      )}
      <ActionButton icon="download" label={t('export.pdf')} className="btn primary block" testId="pnl-pdf" run={async () => {
        try {
          const { pnlPdf } = await import('@/features/pdf');
          await shareFile(pnlPdf(book, from, to, t, i18n.language === 'fr' ? 'fr-FR' : 'en-GB'), `kopor-profit-loss-${from}-${to}.pdf`, t('pnl.title'));
        } catch (e) { fail(e); }
      }} />
    </Page>
  );
}
