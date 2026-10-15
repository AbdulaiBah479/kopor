import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { getSupabase } from '@/cloud/supabase';
import { connectMonime, disconnectMonime, monimeStatus } from '@/cloud/payments';
import { PayoutSheet } from './Groups';

export function Payments() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const { fmt } = useDate();
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [status, setStatus] = useState<{ connected: boolean } | null>(null);
  const [f, setF] = useState({ spaceId: '', token: '' });

  useEffect(() => {
    getSupabase().then(async (sb) => {
      setCloud(!!sb);
      if (sb) monimeStatus(ctx.orgId).then(setStatus).catch(() => setStatus({ connected: false }));
    });
  }, [ctx.orgId]);

  const requests = [...book.payments].sort((a, b) => b.created_at - a.created_at);
  return (
    <Page title={t('pay.title')} sub={t('pay.sub')} back="/more">
      <div className="card flat small">{t('pay.intro')}</div>
      {cloud === false && <div className="alert"><Icon name="cloud" /><div>{t('pay.needCloud')}</div></div>}
      {cloud && (
        <div className="card stack">
          <h2><Icon name="shield" size={18} /> Monime <span className={`badge ${status?.connected ? 'good' : ''}`} style={{ marginLeft: 'auto' }}>{status?.connected ? t('pay.connected') : t('pay.notConnected')}</span></h2>
          {status?.connected ? (
            <div className="btn-row">
              {can('payouts') && <button className="btn primary" onClick={() => openSheet(t('pay.payout'), <PayoutSheet amount={0} />)}><Icon name="send" size={18} /> {t('pay.payout')}</button>}
              {can('business') && <button className="btn ghost" onClick={() => confirm(t('common.confirm')) && disconnectMonime(ctx.orgId).then(() => setStatus({ connected: false })).catch(fail)}>{t('pay.disconnect')}</button>}
            </div>
          ) : can('business') && (
            <form className="form" onSubmit={async (e) => {
              e.preventDefault();
              try { await connectMonime(ctx.orgId, f.spaceId.trim(), f.token.trim()); setStatus({ connected: true }); setF({ spaceId: '', token: '' }); toast(t('pay.connected')); } catch (err) { fail(err); }
            }}>
              <div className="small muted"><b>{t('pay.getStarted')}:</b> {t('pay.steps')}</div>
              <Field label={t('pay.spaceId')}><input required pattern="spc-.*" value={f.spaceId} onChange={(e) => setF({ ...f, spaceId: e.target.value })} autoComplete="off" /></Field>
              <Field label={t('pay.token')} hint={t('pay.tokenHelp')}><input required type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" /></Field>
              <button className="btn primary block">{t('pay.connect')}</button>
            </form>
          )}
          <div className="small muted">{t('pay.fee')}</div>
        </div>
      )}
      <h2 style={{ fontSize: 15 }}>{t('pay.requests')}</h2>
      <div className="list">
        {requests.length ? requests.map((p) => (
          <div key={p.id} className="item">
            <div className="avatar"><Icon name={p.kind === 'payout' ? 'send' : p.kind === 'ussd' ? 'phone' : 'link'} size={18} /></div>
            <div className="main"><div className="t">{p.note || p.kind}</div><div className="s">{fmt(new Date(p.created_at).toISOString().slice(0, 10))}{p.ussd_code && ` · ${p.ussd_code}`}</div></div>
            <div className="amt num">{formatMoney(p.amount)}<small className={p.status === 'completed' ? 'good' : p.status === 'failed' ? 'bad' : ''}>{t(`pay.status.${p.status}`)}</small></div>
          </div>
        )) : <Empty icon="phone" title={t('pay.noRequests')} />}
      </div>
    </Page>
  );
}
