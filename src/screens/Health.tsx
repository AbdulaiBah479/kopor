import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBook } from '@/state/app';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { ScoreRing, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today, addDays, fmtMonth } from '@/lib/dates';
import { refCode } from '@/lib/crypto';
import { health, monthlySeries, type HealthPart } from '@/domain/health';
import { summary, topProducts } from '@/domain/cash';
import { creditTotals } from '@/domain/credit';
import { stockValue } from '@/domain/stock';
import { ActionButton } from '@/ui/extras';
import { useOverlay } from '@/ui/overlay';
import { shareFile } from '@/lib/share';

function tip(t: (k: string, o?: Record<string, unknown>) => string, p: HealthPart) {
  const x = p.params;
  if (p.key === 'records') return t('health.tips.records', x);
  if (p.key === 'profit') return x.hasSales ? t('health.tips.profit', x) : t('health.tips.profitNone');
  if (p.key === 'credit') return x.overdue ? t('health.tips.creditOverdue', x) : x.hasCredit ? t('health.tips.credit', x) : t('health.tips.creditNone');
  return x.hasPrev ? t('health.tips.growth', { change: (x.change > 0 ? '+' : '') + x.change }) : t('health.tips.growthNone');
}

export function Health() {
  const { t } = useTranslation();
  const book = useBook();
  const h = health(book);
  return (
    <Page title={t('health.title')} sub={t('health.sub')} back="/more">
      <div className="card row">
        <ScoreRing score={h.score} size={96} />
        <div><div style={{ fontSize: 22, fontWeight: 800 }}>{t(`health.labels.${h.label}`)}</div><div className="small muted">{t('health.updated')}</div></div>
      </div>
      <div className="card stack" style={{ gap: 16 }}>
        {h.parts.map((p) => (
          <div key={p.key} className="stack" style={{ gap: 4 }}>
            <div className="row between"><b>{t(`health.parts.${p.key}`)}</b><span className="num small">{Math.round(p.score)} / {p.max}</span></div>
            <div className="meter"><i style={{ width: `${(p.score / p.max) * 100}%` }} /></div>
            <div className="small muted">{tip(t, p)}</div>
          </div>
        ))}
      </div>
      <Link className="btn primary block" to="/report"><Icon name="bank" size={18} /> {t('health.openReport')}</Link>
      <div className="card flat small">{t('health.reportHelp')}</div>
    </Page>
  );
}

export function Report() {
  const { t } = useTranslation();
  const book = useBook();
  const { fmt, loc } = useDate();
  const { fail } = useOverlay();
  const now = today(), from = addDays(now, -89);
  const h = health(book, now);
  const months = monthlySeries(book, 3, now);
  const q = summary(book, from, now);
  const credit = creditTotals(book);
  const top = topProducts(book, from, now, 5);
  const code = refCode([book.org.id, now, q.sales, q.expenses, h.score].join('|'));
  const org = book.org;
  return (
    <Page title={t('health.openReport')} back="/health">
      <div className="doc">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><h2>{org.name}</h2><div className="small">{t(`orgTypes.${org.type}`, { defaultValue: org.type })}{org.address && ` · ${org.address}`}<br />{org.owner_name}{org.phone && ` · ${org.phone}`}</div></div>
          <div style={{ textAlign: 'right' }}><b>{t('health.reportTitle')}</b><div className="small">{fmt(from)} – {fmt(now)}</div></div>
        </div>
        <table>
          <thead><tr><th>{t('health.month')}</th><th className="r">{t('cash.sales')}</th><th className="r">{t('cash.expenses')}</th><th className="r">{t('cash.profit')}</th></tr></thead>
          <tbody>
            {months.map((m) => <tr key={m.month}><td>{fmtMonth(m.month, loc)}</td><td className="r">{formatMoney(m.sales)}</td><td className="r">{formatMoney(m.expenses)}</td><td className="r">{formatMoney(m.profit)}</td></tr>)}
            <tr className="tot"><td>{t('health.last90')}</td><td className="r">{formatMoney(q.sales)}</td><td className="r">{formatMoney(q.expenses)}</td><td className="r">{formatMoney(q.profit)}</td></tr>
          </tbody>
        </table>
        <table><tbody>
          <tr><td>{t('health.avgSales')}</td><td className="r"><b>{formatMoney(Math.round(q.sales / 3))}</b></td></tr>
          <tr><td>{t('health.margin')}</td><td className="r"><b>{q.sales ? Math.round((q.profit / q.sales) * 100) : 0}%</b></td></tr>
          <tr><td>{t('health.owedToBiz')}</td><td className="r">{formatMoney(credit.get)}</td></tr>
          <tr><td>{t('health.owedBySupp')}</td><td className="r">{formatMoney(credit.give)}</td></tr>
          <tr><td>{t('health.stockValue')}</td><td className="r">{formatMoney(stockValue(book))}</td></tr>
          <tr><td>{t('health.txCount')}</td><td className="r">{q.count}</td></tr>
          <tr><td>{t('health.activeDays')}</td><td className="r">{h.activeDays}</td></tr>
          <tr><td><b>{t('health.score')}</b></td><td className="r"><b>{h.score}/100 ({t(`health.labels.${h.label}`)})</b></td></tr>
        </tbody></table>
        {top.length > 0 && <div className="small"><b>{t('health.topProducts')}:</b> {top.map((p) => p.name).join(', ')}</div>}
        <div className="foot">{t('health.disclaimer', { date: fmt(now), code })}</div>
      </div>
      <div className="btn-row no-print">
        <ActionButton icon="download" label={t('export.pdf')} className="btn primary" testId="report-pdf" run={async () => {
          try { const { reportPdf } = await import('@/features/pdf'); await shareFile(reportPdf(book, t, loc), `kopor-report-${now}.pdf`, t('health.reportTitle')); } catch (e) { fail(e); }
        }} />
        <button className="btn" onClick={() => window.print()}><Icon name="print" size={18} /> {t('common.print')}</button>
      </div>
    </Page>
  );
}
