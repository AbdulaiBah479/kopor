import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { getSupabase } from '@/cloud/supabase';
import { connectEasy, connectMonime, disconnectMonime, monimeStatus, type MonimeStatus } from '@/cloud/payments';
import { networkOf, normalizeSlPhone } from '@/lib/momo';
import { PayoutSheet } from './Groups';

export function Payments() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const { fmt } = useDate();
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [status, setStatus] = useState<MonimeStatus | null>(null);
  const [f, setF] = useState({ spaceId: '', token: '' });
  const [own, setOwn] = useState(false);       // show the "own Monime account" form instead of the easy way
  const [changing, setChanging] = useState(false);
  const off: MonimeStatus = { connected: false, mode: null, easyAvailable: false };
  const reload = () => monimeStatus(ctx.orgId).then(setStatus).catch(() => setStatus(off));

  useEffect(() => {
    getSupabase().then(async (sb) => {
      setCloud(!!sb);
      if (sb) monimeStatus(ctx.orgId).then(setStatus).catch(() => setStatus({ connected: false, mode: null, easyAvailable: false }));
    });
  }, [ctx.orgId]);
  const network = (id?: string) => (id === 'm17' ? t('easy.orange') : id === 'm18' ? t('easy.afri') : '');
  const disconnect = () => confirm(t('common.confirm')) && disconnectMonime(ctx.orgId).then(() => { setStatus({ ...(status ?? off), connected: false, mode: null }); setChanging(false); }).catch(fail);
  const easyForm = <EasyForm onSaved={(phone) => { toast(t('easy.saved', { phone })); setChanging(false); reload(); }} />;

  const requests = [...book.payments].sort((a, b) => b.created_at - a.created_at);
  return (
    <Page title={t('pay.title')} sub={t('pay.sub')} back="/more">
      {(status?.mode === 'own' || own || (status && !status.easyAvailable && status.mode !== 'easy')) && <div className="card flat small">{t('pay.intro')}</div>}
      {cloud === false && <div className="alert"><Icon name="cloud" /><div>{t('pay.needCloud')}</div></div>}
      {cloud && (
        <div className="card stack">
          <h2><Icon name="shield" size={18} /> Monime <span className={`badge ${status?.connected ? 'good' : ''}`} style={{ marginLeft: 'auto' }}>{status?.connected ? t('pay.connected') : t('pay.notConnected')}</span></h2>
          {status?.mode === 'easy' && !changing ? (
            <div className="stack" data-testid="easy-on">
              <div><b>{t('easy.connected', { phone: status.phone, network: network(status.providerId) })}</b></div>
              {can('business') && (
                <label className="check"><input type="checkbox" checked={status.auto !== false} onChange={(e) => {
                  const auto = e.target.checked;
                  setStatus({ ...status, auto });   // show the change at once; undo it if the server refuses
                  connectEasy(ctx.orgId, { auto }).catch((err) => { setStatus({ ...status, auto: !auto }); fail(err); });
                }} /> {t('easy.auto')}</label>
              )}
              {status.auto === false && <div className="small muted">{t('easy.autoOff')}</div>}
              <div className="btn-row">
                {can('payouts') && <button className="btn primary" onClick={() => openSheet(t('pay.payout'), <PayoutSheet amount={0} />)}><Icon name="send" size={18} /> {t('pay.payout')}</button>}
                {can('business') && <button className="btn ghost" onClick={() => setChanging(true)}>{t('easy.change')}</button>}
                {can('business') && <button className="btn ghost" onClick={disconnect}>{t('pay.disconnect')}</button>}
              </div>
              <div className="small muted">{t('easy.fees')}</div>
            </div>
          ) : status?.mode === 'own' ? (
            <div className="btn-row">
              {can('payouts') && <button className="btn primary" onClick={() => openSheet(t('pay.payout'), <PayoutSheet amount={0} />)}><Icon name="send" size={18} /> {t('pay.payout')}</button>}
              {can('business') && <button className="btn ghost" onClick={disconnect}>{t('pay.disconnect')}</button>}
            </div>
          ) : can('business') && status && status.easyAvailable && !own ? (
            <div className="stack">
              {easyForm}
              {!changing && <button type="button" className="btn ghost sm" onClick={() => setOwn(true)}>{t('easy.own')}</button>}
              {changing && <button type="button" className="btn ghost sm" onClick={() => setChanging(false)}>{t('common.cancel')}</button>}
            </div>
          ) : can('business') && status && (
            <form className="form" onSubmit={async (e) => {
              e.preventDefault();
              try { await connectMonime(ctx.orgId, f.spaceId.trim(), f.token.trim()); setStatus({ ...status, connected: true, mode: 'own' }); setF({ spaceId: '', token: '' }); toast(t('pay.connected')); } catch (err) { fail(err); }
            }}>
              {!status.easyAvailable && <div className="small muted" data-testid="easy-soon">{t('easy.soon')}</div>}
              <div className="small muted"><b>{t('pay.getStarted')}:</b> {t('pay.steps')}</div>
              <Field label={t('pay.spaceId')}><input required pattern="spc-.*" value={f.spaceId} onChange={(e) => setF({ ...f, spaceId: e.target.value })} autoComplete="off" /></Field>
              <Field label={t('pay.token')} hint={t('pay.tokenHelp')}><input required type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" /></Field>
              <button className="btn primary block">{t('pay.connect')}</button>
              {status.easyAvailable && <button type="button" className="btn ghost sm" onClick={() => setOwn(false)}>{t('easy.ownHide')}</button>}
            </form>
          )}
          {status?.mode !== 'easy' && <div className="small muted">{t('pay.fee')}</div>}
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

/** Easy payments: the owner types a mobile money number; the network is worked out from it (or picked if unusual). */
function EasyForm({ onSaved }: { onSaved: (phone: string) => void }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { fail } = useOverlay();
  const [phone, setPhone] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const full = normalizeSlPhone(phone);
  const guess = full ? networkOf(full) : null;
  return (
    <form className="form" data-testid="easy-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!full) return fail(new Error(t('easy.badNumber')));
      try { setBusy(true); const r = await connectEasy(ctx.orgId, { phone: full, ...(guess ? {} : { providerId: pick }) }); onSaved(r.phone); }
      catch (err) { fail(err); } finally { setBusy(false); }
    }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>{t('easy.title')}</h3>
      <div className="small muted">{t('easy.help')}</div>
      <Field label={t('easy.phone')} hint={guess ? `${t('easy.network')}: ${t(guess === 'm17' ? 'easy.orange' : 'easy.afri')}` : undefined}>
        <input required type="tel" inputMode="tel" autoComplete="tel" placeholder="076 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {full && !guess && (
        <Field label={t('easy.pickNetwork')}>
          <select required value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="" />
            <option value="m17">{t('easy.orange')}</option>
            <option value="m18">{t('easy.afri')}</option>
          </select>
        </Field>
      )}
      <button className="btn primary block" disabled={busy}><Icon name="phone" size={18} /> {t('easy.connect')}</button>
      <div className="small muted">{t('easy.fees')}</div>
    </form>
  );
}
