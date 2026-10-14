import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Avatar, BarChart, Money, ScoreRing, useDate } from '@/ui/widgets';
import { SearchSheet } from '@/ui/SearchSheet';
import { formatMoney } from '@/lib/money';
import { today, monthStart, addDays } from '@/lib/dates';
import { waLink } from '@/lib/phone';
import { getMeta } from '@/db/repo';
import { summary, dailySeries, itemsLabel } from '@/domain/cash';
import { balances, creditTotals, overdueSince } from '@/domain/credit';
import { health } from '@/domain/health';
import { insights } from '@/domain/insights';
import { SaleSheet, ExpenseSheet } from './Cash';
import { NewCreditSheet, useReminderText } from './Credit';

// AI tools (and their validation library) download only when first used.
const VoiceSheet = lazy(() => import('./AiSheets').then((m) => ({ default: m.VoiceSheet })));
const ScanSheet = lazy(() => import('./AiSheets').then((m) => ({ default: m.ScanSheet })));

type Period = 'today' | 'week' | 'month';

export function Home() {
  const { t } = useTranslation();
  const book = useBook();
  const { member, can, session, switchSession } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const remind = useReminderText();
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>('today');
  const now = today();
  const from = period === 'today' ? now : period === 'week' ? addDays(now, -6) : monthStart(now);
  const s = summary(book, from, now);
  const credit = creditTotals(book);
  const h = health(book, now);
  const tips = insights(book, now).slice(0, 3);
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? 'home.greetMorning' : hour < 17 ? 'home.greetAfternoon' : 'home.greetEvening');
  const bal = balances(book.ledger);
  const debtors = book.contacts
    .map((c) => ({ c, b: bal.get(c.id) ?? 0, od: overdueSince(book.ledger, c.id, now) }))
    .filter((x) => x.b > 0)
    .sort((a, b) => Number(!!b.od) - Number(!!a.od) || b.b - a.b)
    .slice(0, 4);
  const recent = [...book.txns].sort((a, b) => b.created_at - a.created_at).slice(0, 5);

  // First visit: a short guided tour (shown once per device).
  useEffect(() => {
    let cancelled = false;
    getMeta('tourDone', false).then((done) => {
      if (!done && !cancelled) setTimeout(() => !cancelled && import('@/features/tour').then((m) => m.startTour(t)), 600);
    });
    return () => { cancelled = true; };
  }, [t]);

  const fmtIns = (params: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === 'amount' && typeof v === 'number' ? formatMoney(v) : k === 'cat' ? t(`categories.${v}`) : v]));
  const sale = () => openSheet(t('cash.newSale'), <SaleSheet />);
  const expense = () => openSheet(t('cash.newExpense'), <ExpenseSheet />);
  const creditEntry = () => openSheet(t('credit.addEntry'), <NewCreditSheet />);
  const speak = () => openSheet(t('ai.speakTitle'), <Suspense fallback={t('common.loading')}><VoiceSheet /></Suspense>);
  const scan = () => openSheet(t('ai.scanTitle'), <Suspense fallback={t('common.loading')}><ScanSheet /></Suspense>);
  const search = () => openSheet(t('ux.searchTitle'), <SearchSheet actions={[
    { label: t('cash.newSale'), icon: 'plus', run: sale }, { label: t('cash.newExpense'), icon: 'minus', run: expense },
    { label: t('credit.addEntry'), icon: 'book', run: creditEntry }, { label: t('ai.speakTitle'), icon: 'mic', run: speak },
    { label: t('inv.new'), icon: 'file', run: () => nav('/invoices') }, { label: t('settings.reminders'), icon: 'bell', run: () => nav('/reminders') },
  ]} />);

  const canPickBranch = book.branches.length > 1 && member && !member.branch_id;
  const periodLabel = t(period === 'today' ? 'ux.periodToday' : period === 'week' ? 'ux.periodWeek' : 'ux.periodMonth');

  return (
    <Page title={book.org.name} sub={`${greet}${member ? ', ' + member.name.split(' ')[0] : ''}`}
      right={<>
        <button className="icon-btn" onClick={search} aria-label={t('ux.searchTitle')} data-testid="search"><Icon name="search" /></button>
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
        <div className="relative z-[1] mb-3 flex gap-1 rounded-xl bg-white/12 p-1" role="tablist" aria-label={t('home.todayProfit')}>
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${period === p ? 'bg-white text-[#0a5a37]' : 'text-white/85'}`}>
              {t(p === 'today' ? 'ux.periodToday' : p === 'week' ? 'ux.periodWeek' : 'ux.periodMonth')}
            </button>
          ))}
        </div>
        <div className="label">{period === 'today' ? t('home.todayProfit') : t('ux.profitFor', { period: periodLabel })}</div>
        <div className="big">{formatMoney(s.profit)}</div>
        <div className="mini">
          <div><span>{t('ux.salesFor')}</span><b>{formatMoney(s.sales)}</b></div>
          <div><span>{t('ux.expensesFor')}</span><b>{formatMoney(s.expenses)}</b></div>
        </div>
      </div>

      {can('record') && (
        <div className="quick six" data-tour="quick">
          <button onClick={sale}><span className="qi"><Icon name="plus" /></span>{t('home.sale')}</button>
          <button onClick={expense}><span className="qi out"><Icon name="minus" /></span>{t('home.expense')}</button>
          <button onClick={creditEntry}><span className="qi"><Icon name="book" /></span>{t('home.credit')}</button>
          <button data-tour="speak" onClick={speak}><span className="qi ai"><Icon name="mic" /></span>{t('home.speak')}</button>
          <button onClick={scan}><span className="qi ai"><Icon name="camera" /></span>{t('home.scan')}</button>
          <button onClick={() => nav('/assistant')}><span className="qi ai"><Icon name="spark" /></span>{t('home.ask')}</button>
        </div>
      )}

      {tips.length > 0 && (
        <section className="stack" aria-label={t('home.insights')} data-tour="insights">
          {tips.map((i) => (
            <Link key={i.id} to={i.link ?? '/'} className={`insight ${i.tone}`}>
              <Icon name={i.tone === 'bad' ? 'alert' : i.tone === 'good' ? 'trendUp' : i.key === 'ins.salesDown' ? 'trendDown' : 'spark'} />
              <span className="flex-1">{t(i.key, fmtIns(i.params))}</span>
              <Icon name="chev" size={16} className="text-subtle" />
            </Link>
          ))}
        </section>
      )}

      <div className="grid2">
        <Link className="stat" to="/credit"><div className="k">{t('home.youGet')}</div><div className="v"><Money v={credit.get} className="good" /></div></Link>
        <Link className="stat" to="/credit"><div className="k">{t('home.youGive')}</div><div className="v"><Money v={credit.give} className="bad" /></div></Link>
      </div>

      <div className="section-title"><span>{t('ux.toCollect')}</span><Link to="/credit">{t('ux.seeAll')}</Link></div>
      <div className="list">
        {debtors.length ? debtors.map(({ c, b, od }) => (
          <div key={c.id} className="item" onClick={() => nav(`/credit/${c.id}`)}>
            <Avatar name={c.name} />
            <div className="main">
              <div className="t">{c.name}</div>
              <div className="s">{od ? <span className="bad">{t('credit.overdue')} · {fmt(od)}</span> : c.phone || '—'}</div>
            </div>
            <div className="amt good">{formatMoney(b)}</div>
            {c.phone && (
              <a className="icon-btn bg-primary-soft text-primary" href={waLink(c.phone, remind(c), book.org.country_code)} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()} aria-label={`${t('ux.remind')} ${c.name}`}><Icon name="chat" size={19} /></a>
            )}
          </div>
        )) : <div className="empty"><Icon name="check" /><b>{t('ux.noDebts')}</b></div>}
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
            <div className="small muted">{t('home.thisMonth', { sales: formatMoney(summary(book, monthStart(now), now).sales), profit: formatMoney(summary(book, monthStart(now), now).profit) })}</div>
          </div>
          <Icon name="chev" />
        </Link>
      )}

      {recent.length > 0 && (
        <>
          <div className="section-title"><span>{t('ux.recent')}</span><Link to="/cash">{t('ux.seeAll')}</Link></div>
          <div className="list">
            {recent.map((x) => (
              <Link key={x.id} to="/cash" className="item">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${x.type === 'in' ? 'bg-primary-soft text-primary' : 'bg-warning-soft text-warning'}`}>
                  <Icon name={x.type === 'in' ? 'down' : 'up'} size={18} />
                </span>
                <div className="main">
                  <div className="t">{x.type === 'in' ? itemsLabel(x.items) || x.note || t('categories.sale') : t(`categories.${x.category}`)}</div>
                  <div className="s">{t(`methods.${x.method}`)} · {fmt(x.date)}</div>
                </div>
                <div className={`amt ${x.type === 'in' ? 'good' : 'bad'}`}>{x.type === 'in' ? '+' : '−'}{formatMoney(x.amount)}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="grid3">
        <Link className="stat" to="/groups"><div className="k">{t('home.groups')}</div><div className="v num">{book.groups.length}</div></Link>
        <Link className="stat" to="/invoices"><div className="k">{t('home.unpaidInvoices')}</div><div className="v num">{book.invoices.filter((i) => i.status === 'unpaid').length}</div></Link>
        <Link className="stat" to="/stock"><div className="k">{t('home.products')}</div><div className="v num">{book.products.length}</div></Link>
      </div>
    </Page>
  );
}
