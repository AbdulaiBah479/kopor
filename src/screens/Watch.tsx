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
import { byPerson, watchFlags, type FlagKind } from '@/domain/watch';

const ICON: Record<FlagKind, string> = { short: 'cash', momoShort: 'phone', deleted: 'trash', refund: 'undo', discount: 'tag', lost: 'box', belowCost: 'trendDown', unconfirmed: 'alert', attendance: 'users', lateNight: 'moon' };

export function Watch() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { fmt } = useDate();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<'people' | 'all' | 'safe'>('people');
  const [reversals, setReversals] = useState<WalletTxn[]>([]);
  useEffect(() => { list('audit', ctx.orgId).then(setAudit).catch(() => {}); }, [ctx.orgId, book]);
  // Reversals show only in Monime's own records (it sends no message for them), so look there when connected.
  useEffect(() => {
    let live = true;
    getSupabase().then((sb) => sb && monimeStatus(ctx.orgId)).then((s) => s?.connected ? walletHistory(ctx.orgId) : null)
      .then((h) => live && h && setReversals(h.items.filter((i) => i.kind === 'reversal'))).catch(() => {});
    return () => { live = false; };
  }, [ctx.orgId]);
  const flags = useMemo(() => watchFlags(book, audit), [book, audit]);
  const people = byPerson(flags);
  const unconfirmed = flags.filter((f) => f.kind === 'unconfirmed');
  return (
    <Page title={t('watch.title')} sub={t('watch.sub')} back="/more">
      <Seg value={tab} onChange={setTab} options={[['people', t('watch.people')], ['all', t('watch.all', { n: flags.length })], ['safe', t('watch.safe')]]} />
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
      {tab === 'all' && (flags.length ? (
        <div className="list" data-testid="watch-flags">
          {flags.map((f, i) => (
            <div key={i} className="item" data-kind={f.kind}>
              <div className="avatar"><Icon name={ICON[f.kind]} size={18} /></div>
              <div className="main">
                <div className="t">{t(`watch.k.${f.kind}`)} · {f.who}</div>
                <div className="s">{fmt(f.date)}{f.detail ? ` · ${f.kind === 'attendance' ? f.detail.split(',').map((x) => t(`watch.att.${x}`)).join(', ') : f.kind === 'unconfirmed' || f.kind === 'momoShort' ? t(`methods.${f.detail}`) : f.detail}` : ''}</div>
              </div>
              <div className="amt num">{f.amount ? formatMoney(f.amount) : ''}</div>
            </div>
          ))}
        </div>
      ) : <Empty icon="shield" title={t('watch.clean')} text={t('watch.cleanHelp')} />)}
      {tab === 'safe' && <SafetyTips />}
    </Page>
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
