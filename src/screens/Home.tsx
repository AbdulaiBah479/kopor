import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { BarChart, Money, ScoreRing } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today, monthStart } from '@/lib/dates';
import { summary, dailySeries } from '@/domain/cash';
import { creditTotals } from '@/domain/credit';
import { health } from '@/domain/health';
import { insights } from '@/domain/insights';
import { SaleSheet, ExpenseSheet } from './Cash';
import { NewCreditSheet } from './Credit';
import { lazy, Suspense, useEffect } from 'react';
import { getMeta } from '@/db/repo';

// AI tools (and their validation library) download only when first used.
const VoiceSheet = lazy(() => import('./AiSheets').then((m) => ({ default: m.VoiceSheet })));
const ScanSheet = lazy(() => import('./AiSheets').then((m) => ({ default: m.ScanSheet })));

export function Home() {
  const { t } = useTranslation();
  const book = useBook();
  const { member, can, session, switchSession } = useApp();
  const { openSheet } = useOverlay();
  const nav = useNavigate();
  const now = today();
  const day = summary(book, now, now);
  const month = summary(book, monthStart(now), now);
  const credit = creditTotals(book);
  const h = health(book, now);
  const tips = insights(book, now).slice(0, 4);
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'home.greetMorning' : hour < 17 ? 'home.greetAfternoon' : 'home.greetEvening');

  const fmtIns = (params: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === 'amount' && typeof v === 'number' ? formatMoney(v) : k === 'cat' ? t(`categories.${v}`) : v]));

  const canPickBranch = book.branches.length > 1 && member && !member.branch_id;

  // First visit: a short guided tour (shown once per device).
  useEffect(() => {
    let cancelled = false;
    getMeta('tourDone', false).then((done) => {
      if (!done && !cancelled) setTimeout(() => !cancelled && import('@/features/tour').then((m) => m.startTour(t)), 600);
    });
    return () => { cancelled = true; };
  }, [t]);

  return (
    <Page title={book.org.name} sub={`${greet}${member ? ', ' + member.name.split(' ')[0] : ''}`}
      right={<>
        <Link className="icon-btn" to="/help" aria-label={t('help.title')}><Icon name="help" /></Link>
        <Link className="icon-btn" to="/settings" aria-label={t('settings.title')}><Icon name="sliders" /></Link>
      </>}>
      {canPickBranch && (
        <select className="input" aria-label={t('home.branch')} value={session?.branchId ?? ''}
          onChange={(e) => switchSession({ ...session!, branchId: e.target.value || null })}>
          <option value="">{t('home.allBranches')}</option>
          {book.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}

      <div className="hero" data-tour="hero">
        <div className="label">{t('home.todayProfit')}</div>
        <div className="big num">{formatMoney(day.profit)}</div>
        <div className="mini">
          <div><span>{t('home.salesToday')}</span><b className="num">{formatMoney(day.sales)}</b></div>
          <div><span>{t('home.expensesToday')}</span><b className="num">{formatMoney(day.expenses)}</b></div>
        </div>
      </div>

      {can('record') && (
        <div className="quick six" data-tour="quick">
          <button onClick={() => openSheet(t('cash.newSale'), <SaleSheet />)}><span className="qi"><Icon name="plus" /></span>{t('home.sale')}</button>
          <button onClick={() => openSheet(t('cash.newExpense'), <ExpenseSheet />)}><span className="qi out"><Icon name="minus" /></span>{t('home.expense')}</button>
          <button onClick={() => openSheet(t('credit.addEntry'), <NewCreditSheet />)}><span className="qi"><Icon name="book" /></span>{t('home.credit')}</button>
          <button data-tour="speak" onClick={() => openSheet(t('ai.speakTitle'), <Suspense fallback={t('common.loading')}><VoiceSheet /></Suspense>)}><span className="qi ai"><Icon name="mic" /></span>{t('home.speak')}</button>
          <button onClick={() => openSheet(t('ai.scanTitle'), <Suspense fallback={t('common.loading')}><ScanSheet /></Suspense>)}><span className="qi ai"><Icon name="camera" /></span>{t('home.scan')}</button>
          <button onClick={() => nav('/assistant')}><span className="qi ai"><Icon name="spark" /></span>{t('home.ask')}</button>
        </div>
      )}

      {tips.length > 0 && (
        <section className="stack" aria-label={t('home.insights')} data-tour="insights">
          {tips.map((i) => (
            <Link key={i.id} to={i.link ?? '/'} className={`insight ${i.tone}`}>
              <Icon name={i.tone === 'bad' ? 'alert' : i.tone === 'good' ? 'up' : 'spark'} />
              <span>{t(i.key, fmtIns(i.params))}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="grid2">
        <Link className="stat" to="/credit"><div className="k">{t('home.youGet')}</div><div className="v"><Money v={credit.get} className="good" /></div></Link>
        <Link className="stat" to="/credit"><div className="k">{t('home.youGive')}</div><div className="v"><Money v={credit.give} className="bad" /></div></Link>
      </div>

      <div className="card">
        <h3>{t('home.last7')} <Link className="right" to="/cash">{t('home.cashBook')} <Icon name="chev" size={14} /></Link></h3>
        <BarChart series={dailySeries(book, 7, now)} />
      </div>

      {can('reports') && (
        <Link className="card row" to="/health" style={{ color: 'inherit' }}>
          <ScoreRing score={h.score} />
          <div className="spacer">
            <div className="muted small">{t('home.healthScore')}</div>
            <div style={{ fontSize: 18, fontWeight: 750 }}>{t(`health.labels.${h.label}`)}</div>
            <div className="small muted">{t('home.thisMonth', { sales: formatMoney(month.sales), profit: formatMoney(month.profit) })}</div>
          </div>
          <Icon name="chev" />
        </Link>
      )}

      <div className="grid3">
        <Link className="stat" to="/groups"><div className="k">{t('home.groups')}</div><div className="v num">{book.groups.length}</div></Link>
        <Link className="stat" to="/invoices"><div className="k">{t('home.unpaidInvoices')}</div><div className="v num">{book.invoices.filter((i) => i.status === 'unpaid').length}</div></Link>
        <Link className="stat" to="/stock"><div className="k">{t('home.products')}</div><div className="v num">{book.products.length}</div></Link>
      </div>
    </Page>
  );
}
