// Fraud watch (owners and managers): warning signs of theft, scams and mistakes in the last 30 days, per person and
// one by one, plus mobile money reversals seen on a connected Monime account, and how to stay safe.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Seg, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { list } from '@/db/repo';
import type { AuditEntry } from '@/db/schema';
import { getSupabase } from '@/cloud/supabase';
import { monimeStatus, walletHistory, type WalletTxn } from '@/cloud/payments';
import { byBranch, byPerson, watchFlags, type Flag, type FlagKind } from '@/domain/watch';
import { updateOrg } from '@/domain/org';
import { useOverlay } from '@/ui/overlay';
import { useAlerts } from '@/features/alertStore';
import type { AlertRow } from '@/cloud/alerts';
import { ApprovalsCard } from './Approvals';
import { MoneyInput, Field } from '@/ui/widgets';

const ICON: Record<FlagKind, string> = {
  short: 'cash', momoShort: 'phone', deleted: 'trash', refund: 'undo', discount: 'tag', lost: 'box', belowCost: 'trendDown', unconfirmed: 'alert', attendance: 'users', lateNight: 'moon',
  underPriced: 'tag', backdated: 'calendar', absentWork: 'users', noClose: 'lock', ghostCredit: 'book', selfCredit: 'book', bigExpense: 'up', dupRef: 'copy', refundNoSale: 'undo', noItems: 'box', dupPhone: 'phone', habitDiscount: 'tag', staffDiscount: 'tag', lowShift: 'trendDown',
};

export function Watch() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { fmt } = useDate();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<'people' | 'branches' | 'all' | 'safe'>('people');
  const [reversals, setReversals] = useState<WalletTxn[]>([]);
  useEffect(() => { list('audit', ctx.orgId).then(setAudit).catch(() => {}); }, [ctx.orgId, book]);
  // Reversals show only in Monime's own records (it sends no message for them), so look there when connected.
  useEffect(() => {
    let live = true;
    getSupabase().then((sb) => sb && monimeStatus(ctx.orgId)).then((s) => s?.connected ? walletHistory(ctx.orgId) : null)
      .then((h) => live && h && setReversals(h.items.filter((i) => i.kind === 'reversal'))).catch(() => {});
    return () => { live = false; };
  }, [ctx.orgId]);
  const live = useAlerts();
  // Opening Fraud watch marks the alerts as seen (the banner on Home goes away).
  useEffect(() => { import('@/features/alertWatch').then((m) => m.markAlertsSeen(ctx.orgId)).catch(() => {}); }, [ctx.orgId, live]);
  const flags = useMemo(() => watchFlags(book, audit), [book, audit]);
  const people = byPerson(flags);
  const branches = book.branches.length > 1 ? byBranch(flags) : [];
  const branchName = (id: string | null) => book.branches.find((b) => b.id === id)?.name ?? t('watch.noBranch');
  const unconfirmed = flags.filter((f) => f.kind === 'unconfirmed');
  const detail = (f: Flag) => f.kind === 'attendance' ? f.detail.split(',').map((x) => t(`watch.att.${x}`)).join(', ')
    : f.kind === 'unconfirmed' || f.kind === 'momoShort' ? t(`methods.${f.detail}`)
    : f.kind === 'backdated' ? t('watch.putOn', { date: fmt(f.detail) })
    : f.kind === 'absentWork' ? t(`staff.st.${f.detail}`)
    : f.kind === 'short' && f.detail === 'handover' ? t('watch.atHandover')
    : f.kind === 'noItems' ? t('watch.noItemsOf', { share: f.detail })
    : f.kind === 'habitDiscount' ? t('watch.habitOf', { n: f.detail })
    : f.kind === 'staffDiscount' ? t('watch.staffDiscBy', { who: f.detail })
    : f.kind === 'lowShift' ? t('watch.lowShiftOf', { share: f.detail })
    : f.kind === 'dupRef' ? t('watch.refUsed', { ref: f.detail.split(' · ')[0], who: f.detail.split(' · ')[1] })
    : f.detail;
  return (
    <Page title={t('watch.title')} sub={t('watch.sub')} back="/more">
      <Seg value={tab} onChange={setTab} options={[['people', t('watch.people')], ...(branches.length ? [['branches', t('watch.branches')] as ['branches', string]] : []), ['all', t('watch.all', { n: flags.length })], ['safe', t('watch.safe')]]} />
      {tab !== 'safe' && <ApprovalsCard />}
      {tab !== 'safe' && live.length > 0 && <LatestAlerts list={live} />}
      {tab !== 'safe' && reversals.length > 0 && (
        <div className="alert bad" data-testid="reversals"><Icon name="alert" /><div><b>{t('watch.reversals', { n: reversals.length })}</b><br />
          {reversals.slice(0, 5).map((r) => `${new Date(r.time).toLocaleDateString()} ${formatMoney(r.amount)}${r.reference ? ` (${r.reference})` : ''}`).join(' · ')}</div></div>
      )}
      {tab !== 'safe' && unconfirmed.length > 0 && (
        <div className="alert small"><Icon name="phone" /><div>{t('watch.unconfirmed', { n: unconfirmed.length, amount: formatMoney(unconfirmed.reduce((s, f) => s + f.amount, 0)) })}</div></div>
      )}
      {tab === 'people' && (people.length ? (
        <div className="list" data-testid="watch-people">
          {people.map((p) => (
            <div key={p.who} className="item">
              <div className="avatar"><Icon name="users" size={18} /></div>
              <div className="main">
                <div className="t">{p.who}</div>
                <div className="s">{Object.entries(p.kinds).map(([k, n]) => `${t(`watch.k.${k}`)} ×${n}`).join(' · ')}</div>
              </div>
              <div className="amt num">{p.amount ? formatMoney(p.amount) : ''}</div>
            </div>
          ))}
        </div>
      ) : <Empty icon="shield" title={t('watch.clean')} text={t('watch.cleanHelp')} />)}
      {tab === 'branches' && (
        <div className="list" data-testid="watch-branches">
          {branches.map((b) => (
            <div key={b.branch ?? ''} className="item">
              <div className="avatar"><Icon name="store" size={18} /></div>
              <div className="main"><div className="t">{branchName(b.branch)}</div><div className="s">{t('watch.signs', { count: b.count })}</div></div>
              <div className="amt num">{b.amount ? formatMoney(b.amount) : ''}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'all' && (flags.length ? (
        <div className="list" data-testid="watch-flags">
          {flags.map((f, i) => (
            <div key={i} className="item" data-kind={f.kind}>
              <div className="avatar"><Icon name={ICON[f.kind]} size={18} /></div>
              <div className="main">
                <div className="t">{t(`watch.k.${f.kind}`)} · {f.who}</div>
                <div className="s">{fmt(f.date)}{f.detail ? ` · ${detail(f)}` : ''}{f.branch && book.branches.length > 1 ? ` · ${branchName(f.branch)}` : ''}</div>
              </div>
              <div className="amt num">{f.amount ? formatMoney(f.amount) : ''}</div>
            </div>
          ))}
        </div>
      ) : <Empty icon="shield" title={t('watch.clean')} text={t('watch.cleanHelp')} />)}
      {tab === 'safe' && <ProtectCard />}
      {tab === 'safe' && <SafetyTips />}
    </Page>
  );
}

/** The latest alerts the server made (cash short, deletions, away from the shop, fake GPS). */
function LatestAlerts({ list }: { list: AlertRow[] }) {
  const { t } = useTranslation();
  const [text, setText] = useState<((a: AlertRow) => string) | null>(null);
  useEffect(() => { import('@/features/alertWatch').then((m) => setText(() => (a: AlertRow) => m.alertText(t, a))).catch(() => {}); }, [t]);
  if (!text) return null;
  return (
    <div className="card stack" data-testid="latest-alerts">
      <b><Icon name="bell" size={18} className="mr-1 inline" />{t('watch.alert.latest')}</b>
      <div className="list">
        {list.slice(0, 8).map((a) => (
          <div key={a.id} className="item"><div className="main"><div className="t">{text(a)}</div><div className="s">{new Date(a.at).toLocaleString()}</div></div></div>
        ))}
      </div>
    </div>
  );
}

/** Owner's protection settings: the credit limit per customer (cashiers cannot go above it). */
function ProtectCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { toast, fail } = useOverlay();
  const [limit, setLimit] = useState(book.org.credit_limit ?? 0);
  const [over, setOver] = useState(book.org.approve_over ?? 100_000);
  const [payMax, setPayMax] = useState(book.org.payout_daily_max ?? 2_000_000);
  if (!can('business')) return null;
  return (
    <form className="form card" data-testid="protect-form" onSubmit={(e) => { e.preventDefault(); updateOrg(ctx, { credit_limit: limit > 0 ? limit : null, approve_over: over, payout_daily_max: payMax > 0 ? payMax : null }).then(() => toast(t('common.saved'))).catch(fail); }}>
      <b><Icon name="shield" size={18} className="mr-1 inline" />{t('watch.protect')}</b>
      <div className="small">{t('watch.rules')}</div>
      <Field label={t('watch.creditLimit')} hint={t('watch.creditLimitHelp')}><MoneyInput name="credit_limit" value={limit} onChange={setLimit} /></Field>
      <Field label={t('approve.over')} hint={t('approve.overHelp')}><MoneyInput name="approve_over" value={over} onChange={setOver} /></Field>
      <Field label={t('approve.payMax')} hint={t('approve.payMaxHelp')}><MoneyInput name="payout_daily_max" value={payMax} onChange={setPayMax} /></Field>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

/** Plain advice against the scams shops in Sierra Leone meet most. */
export function SafetyTips() {
  const { t } = useTranslation();
  return (
    <div className="stack" data-testid="safety-tips">
      {(['fake', 'reversal', 'pin', 'staff', 'stock', 'phone'] as const).map((k) => (
        <div key={k} className="card stack">
          <b>{t(`watch.tip.${k}.title`)}</b>
          <div className="small">{t(`watch.tip.${k}.text`)}</div>
        </div>
      ))}
    </div>
  );
}
