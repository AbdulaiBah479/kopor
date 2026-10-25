import { Suspense, useEffect, useState } from 'react';
import { lazyRetry } from '@/ui/lazy';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { ScanChooser } from '@/ui/ScanButton';
import { txnIcon } from '@/ui/txnIcon';
import { Avatar, BarChart, Money, ScoreRing, Seg, useDate, Verified } from '@/ui/widgets';
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
import { Announcements } from '@/ui/Announcements';
import { UpdateCard } from '@/ui/UpdateCard';

// AI tools (and their validation library) download only when first used.
const VoiceSheet = lazyRetry(() => import('./AiSheets').then((m) => ({ default: m.VoiceSheet })));
const SearchSheet = lazyRetry(() => import('@/ui/SearchSheet').then((m) => ({ default: m.SearchSheet })));

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
  const month = summary(book, monthStart(now), now);
  // Losses and where the money goes are for owners and managers.
  const tips = insights(book, now).filter((i) => can('reports') || !['loss', 'expense'].includes(i.id)).slice(0, 5);
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
    let stop: (() => void) | undefined;
    getMeta('tourDone', false).then((done) => {
      if (!done && !cancelled) setTimeout(() => { if (!cancelled) import('@/features/tour').then((m) => { if (!cancelled) stop = m.startTour(t); }); }, 600);
    });
    // Leaving Home ends the tour so its overlay never sits on top of another screen.
    return () => { cancelled = true; stop?.(); };
  }, [t]);

  const fmtIns = (params: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === 'amount' && typeof v === 'number' ? formatMoney(v) : k === 'cat' ? t(`categories.${v}`) : v]));
  const sale = () => openSheet(t('cash.newSale'), <SaleSheet />);
  const expense = () => openSheet(t('cash.newExpense'), <ExpenseSheet />);
  const creditEntry = () => openSheet(t('credit.addEntry'), <NewCreditSheet />);
  const speak = () => openSheet(t('ai.speakTitle'), <Suspense fallback={t('common.loading')}><VoiceSheet /></Suspense>);
  const scan = () => openSheet(t('item.chooseTitle'), <ScanChooser />);
  const search = () => openSheet(t('ux.searchTitle'), <Suspense fallback={t('common.loading')}><SearchSheet actions={[
    { label: t('cash.newSale'), icon: 'plus', run: sale }, { label: t('cash.newExpense'), icon: 'minus', run: expense },
    { label: t('credit.addEntry'), icon: 'book', run: creditEntry }, { label: t('ai.speakTitle'), icon: 'mic', run: speak },
    { label: t('ai.askTitle'), icon: 'spark', run: () => nav('/assistant') }, { label: t('inv.new'), icon: 'file', run: () => nav('/invoices') },
    { label: t('settings.reminders'), icon: 'bell', run: () => nav('/reminders') },
  ]} /></Suspense>);

  const canPickBranch = book.branches.length > 1 && member && !member.branch_id;
  const periodLabel = t(period === 'today' ? 'ux.periodToday' : period === 'week' ? 'ux.periodWeek' : 'ux.periodMonth');
  const tone = (x: { tone: string; key: string }) => (x.tone === 'bad' ? 'alert' : x.tone === 'good' ? 'trendUp' : x.key === 'ins.salesDown' ? 'trendDown' : x.key === 'ins.runningOut' ? 'box' : 'spark');

  return (
    <Page guide="home" title={book.org.name} sub={`${greet}${member ? ', ' + member.name.split(' ')[0] : ''}`}
      right={<>
        <button className="icon-btn" onClick={search} aria-label={t('ux.searchTitle')} data-testid="search"><Icon name="search" size={22} /></button>
        <Link className="icon-btn" to="/settings" aria-label={t('settings.title')}><Icon name="sliders" size={22} /></Link>
      </>}>
      <UpdateCard />
      <Announcements />
      {canPickBranch && (
        <select className="input" aria-label={t('home.branch')} value={session?.branchId ?? ''}
          onChange={(e) => switchSession({ ...session!, branchId: e.target.value || null })}>
          <option value="">{t('home.allBranches')}</option>
          {book.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}

      {/* Balance, Wallet/Cash style */}
      <section className="flex flex-col gap-4" data-tour="hero" aria-label={t('home.todayProfit')}>
        <Seg value={period} onChange={setPeriod} options={[['today', t('ux.periodToday')], ['week', t('ux.periodWeek')], ['month', t('ux.periodMonth')]]} />
        {/* One money card (Revolut / Monzo style): the number that matters, its two parts, and the money buttons. */}
        <div className="hero balance-card">
          <div className="balance-head">
            {can('reports') ? <>
              <span className="label">{period === 'today' ? t('home.todayProfit') : t('ux.profitFor', { period: periodLabel })}</span>
              <span className="amount">{formatMoney(s.profit)}</span>
            </> : <>
              <span className="label">{t('ux.salesFor')}</span>
              <span className="amount" data-testid="hero-sales">{formatMoney(s.sales)}</span>
            </>}
            {can('reports') && <span className="split">
              <span><Icon name="down" size={14} className="mr-0.5 inline" />{t('ux.salesFor')} <b>{formatMoney(s.sales)}</b></span>
              <span><Icon name="up" size={14} className="mr-0.5 inline" />{t('ux.expensesFor')} <b>{formatMoney(s.expenses)}</b></span>
            </span>}
          </div>
          {can('record') && (
            <div className="money-actions" data-tour="money">
              <button className="btn on-hero" onClick={() => nav('/money', { state: { open: 'receive' } })} data-testid="home-receive"><Icon name="down" size={20} /> {t('money.receive')}</button>
              <button className="btn on-hero ghost-hero" onClick={() => nav('/money', { state: { open: 'send' } })} data-testid="home-send"><Icon name="up" size={20} /> {t('money.send')}</button>
            </div>
          )}
        </div>
      </section>

      {can('record') && (
        <div className="actions" data-tour="quick">
          <button onClick={sale}><span className="circle primary"><Icon name="plus" size={26} /></span>{t('home.sale')}</button>
          <button onClick={expense}><span className="circle"><Icon name="minus" size={26} /></span>{t('home.expense')}</button>
          <button onClick={creditEntry}><span className="circle"><Icon name="book" size={24} /></span>{t('home.credit')}</button>
          <button data-tour="speak" onClick={speak}><span className="circle"><Icon name="mic" size={24} /></span>{t('home.speak')}</button>
          <button onClick={scan}><span className="circle"><Icon name="camera" size={24} /></span>{t('home.scan')}</button>
        </div>
      )}

      {tips.length > 0 && (
        <section className="carousel" aria-label={t('home.insights')} data-tour="insights">
          {tips.map((i) => (
            <Link key={i.id} to={i.link ?? '/'} className={`insight ${i.tone}`}>
              <Icon name={tone(i)} />
              <span className="flex-1">{t(i.key, fmtIns(i.params))}</span>
            </Link>
          ))}
          <Link to="/assistant" className="insight">
            <Icon name="spark" />
            <span className="flex-1"><b>{t('home.ask')}</b><br /><span className="text-muted-foreground">{t('ai.q1')}</span></span>
          </Link>
        </section>
      )}

      <div className="grid2">
        <Link className="stat" to="/credit"><div className="k">{t('home.youGet')}</div><div className="v"><Money v={credit.get} className="good" /></div></Link>
        <Link className="stat" to="/credit"><div className="k">{t('home.youGive')}</div><div className="v"><Money v={credit.give} className="bad" /></div></Link>
      </div>

      <div className="section-title big"><span>{t('ux.toCollect')}</span><Link to="/credit">{t('ux.seeAll')}</Link></div>
      <div className="list">
        {debtors.length ? debtors.map(({ c, b, od }) => (
          <div key={c.id} className="item">
            <Avatar name={c.name} />
            <div className="main">
              <Link className="t stretch" to={`/credit/${c.id}`}>{c.name}</Link>
              <div className="s">{od ? <span className="bad">{t('credit.overdue')} · {fmt(od)}</span> : c.phone || '—'}</div>
            </div>
            <div className="amt good">{formatMoney(b)}</div>
            {c.phone && (
              <a className="icon-btn filled" href={waLink(c.phone, remind(c), book.org.country_code)} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()} aria-label={`${t('ux.remind')} ${c.name}`}><Icon name="chat" size={18} /></a>
            )}
          </div>
        )) : <div className="empty"><Icon name="check" /><b>{t('ux.noDebts')}</b></div>}
      </div>

      <div className="card">
        <h2>{t('home.last7')} <Link className="right" to="/cash">{t('home.cashBook')} <Icon name="chev" size={16} /></Link></h2>
        <BarChart series={dailySeries(book, 7, now)} />
      </div>

      {can('reports') && (
        <Link className="card row" to="/health" style={{ color: 'inherit' }}>
          <ScoreRing score={h.score} size={72} />
          <div className="spacer">
            <div className="muted small">{t('home.healthScore')}</div>
            <div className="text-[20px] font-bold">{t(`health.labels.${h.label}`)}</div>
            <div className="small muted">{t('home.thisMonth', { sales: formatMoney(month.sales), profit: formatMoney(month.profit) })}</div>
          </div>
          <Icon name="chev" className="text-subtle" />
        </Link>
      )}

      {recent.length > 0 && (
        <>
          <div className="section-title big"><span>{t('ux.recent')}</span><Link to="/cash">{t('ux.seeAll')}</Link></div>
          <div className="list">
            {recent.map((x) => (
              <Link key={x.id} to="/cash" className="item">
                <span className={`icon-dot ${x.type === 'in' ? 'bg-primary-soft text-positive' : 'bg-warning-soft text-warning'}`}>
                  <Icon name={txnIcon(x)} size={20} />
                </span>
                <div className="main">
                  <div className="t">{x.type === 'in' ? itemsLabel(x.items) || x.note || t('categories.sale') : t(`categories.${x.category}`)} <Verified id={x.verified_ref} /></div>
                  <div className="s">{t(`methods.${x.method}`)} · {fmt(x.date)}</div>
                </div>
                <div className={`amt ${x.type === 'in' ? 'good' : ''}`}>{x.type === 'in' ? '+' : '−'}{formatMoney(x.amount)}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
