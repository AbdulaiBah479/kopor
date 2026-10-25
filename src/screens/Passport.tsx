// Credit Passport (owners): share the business's real record with a lender, and the public page the lender opens.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, useDate } from '@/ui/widgets';
import { QrCode } from '@/ui/QrCode';
import { formatMoney, setCurrencySymbol } from '@/lib/money';
import { publicLink } from '@/lib/links';
import { shareText } from '@/lib/share';
import { getSupabase } from '@/cloud/supabase';
import { syncNow } from '@/cloud/sync';
import { listPassports, makePassport, openPassport, revokePassport, type Passport as P, type PassportRow } from '@/cloud/passport';
import { LoadFailed } from './PublicStatement';

export function Passport() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { toast, fail } = useOverlay();
  const { fmt } = useDate();
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [rows, setRows] = useState<(PassportRow & { live: boolean })[]>([]);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState('');
  const load = () => listPassports(ctx.orgId).then((list) => { const now = Date.now(); setRows(list.map((r) => ({ ...r, live: !r.revoked && new Date(r.expires_at).getTime() > now }))); }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { getSupabase().then((s) => { setCloud(!!s); if (s) load(); }); }, [ctx.orgId]);
  if (!can('business')) return <Page title={t('pass.title')} back="/more"><Empty icon="lock" title={t('pass.ownerOnly')} /></Page>;
  const link = (tok: string) => publicLink(`/p/${tok}`);
  const create = async () => {
    try {
      setBusy(true);
      await syncNow(ctx.orgId).catch(() => {});        // the server works from the records it has, so send them first
      const tok = await makePassport(ctx.orgId);
      setShown(tok); toast(t('pass.made')); load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const live = (r: { live: boolean }) => r.live;
  return (
    <Page title={t('pass.title')} sub={t('pass.sub')} back="/more">
      <div className="card flat small stack">
        <b>{t('pass.whatTitle')}</b>
        <div>{t('pass.what')}</div>
        <div className="muted">{t('pass.trust')}</div>
      </div>
      {cloud === false && <div className="alert"><Icon name="cloud" /><div>{t('pass.needCloud')}</div></div>}
      {cloud && <button type="button" className="btn primary block" data-testid="make-passport" disabled={busy} onClick={create}><Icon name="shield" size={18} /> {busy ? t('common.loading') : t('pass.make')}</button>}
      {shown && (
        <div className="card stack" data-testid="passport-share" style={{ alignItems: 'center', textAlign: 'center' }}>
          <QrCode text={link(shown)} />
          <div className="small muted">{t('pass.qrHelp')}</div>
          <div className="btn-row">
            <button type="button" className="btn get" onClick={() => shareText(t('pass.shareMsg', { business: book.org.name, link: link(shown) }))}><Icon name="share" size={18} /> {t('pass.share')}</button>
            <a className="btn" href={`#/p/${shown}`}><Icon name="file" size={18} /> {t('pass.view')}</a>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="section-title"><span>{t('pass.list')}</span></div>
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className="item" style={{ opacity: live(r) ? 1 : 0.55 }}>
                <div className="main">
                  <div className="t">{t('pass.madeOn', { date: fmt(r.created_at.slice(0, 10)) })}</div>
                  <div className="s">{r.revoked ? t('pass.revoked') : live(r) ? t('pass.validTo', { date: fmt(r.expires_at.slice(0, 10)) }) : t('pass.expired')}</div>
                </div>
                {live(r) && (
                  <div className="btn-row">
                    <button type="button" className="btn sm" onClick={() => setShown(r.token)}>{t('pass.share')}</button>
                    <button type="button" className="btn sm danger" onClick={() => confirm(t('pass.revokeWarn')) && revokePassport(r.id).then(() => { toast(t('pass.revokedDone')); if (shown === r.token) setShown(''); load(); }).catch(fail)}>{t('pass.revoke')}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

/** What the lender sees from the link (no sign-in needed). */
export function PublicPassport() {
  const { token } = useParams();
  const [p, setP] = useState<P | null | undefined | 'error'>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { openPassport(token ?? '').then((x) => setP(x)).catch(() => setP('error')); }, [token, attempt]);
  const { t } = useTranslation();
  if (p === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (p === 'error') return <LoadFailed onRetry={() => { setP(undefined); setAttempt(attempt + 1); }} />;
  if (!p) return <div className="shell"><div className="content"><div className="empty" data-testid="passport-missing"><b>{t('pass.notFound')}</b></div></div></div>;
  return <PassportView p={p} />;
}

function PassportView({ p }: { p: P }) {
  const { t } = useTranslation();
  const { fmt } = useDate();
  setCurrencySymbol('Le');
  const d = p.data, n = (x: unknown) => Number(x) || 0;
  const months = d.months.filter((m) => n(m.records) > 0).length;
  const repay = n(d.credit_given_6m) ? Math.round((n(d.credit_repaid_6m) / n(d.credit_given_6m)) * 100) : null;
  const confirmed = n(d.sales_6m) ? Math.round((n(d.monime_confirmed_6m) / n(d.sales_6m)) * 100) : 0;
  const max = Math.max(1, ...d.months.map((m) => n(m.sales)));
  const rows: [string, string][] = [
    [t('pass.sales6'), formatMoney(n(d.sales_6m))], [t('pass.expenses6'), formatMoney(n(d.expenses_6m))],
    [t('pass.profit6'), formatMoney(n(d.sales_6m) - n(d.expenses_6m))], [t('pass.avgMonth'), formatMoney(Math.round(n(d.sales_6m) / 6))],
    [t('pass.activeDays'), t('pass.daysOf', { n: n(d.active_days_6m), months })], [t('pass.records'), String(n(d.records_6m))],
    [t('pass.creditGiven'), formatMoney(n(d.credit_given_6m))], [t('pass.repaid'), repay === null ? '—' : `${formatMoney(n(d.credit_repaid_6m))} (${repay}%)`],
    [t('pass.owedNow'), formatMoney(n(d.customers_owe_now))], [t('pass.confirmed'), `${formatMoney(n(d.monime_confirmed_6m))} (${confirmed}%)`],
    [t('pass.team'), t('pass.teamN', { staff: n(d.staff), branches: n(d.branches) })],
  ];
  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 20 }}>
        <div className="doc stack" data-testid="public-passport">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div><h2 style={{ margin: 0 }}>{d.business.name}</h2>
              <div className="small">{[t(`orgTypes.${d.business.type}`, { defaultValue: d.business.type }), d.business.owner_name, d.business.address, d.business.phone].filter(Boolean).join(' · ')}</div></div>
            <div style={{ textAlign: 'right' }}><b>{t('pass.title')}</b><div className="small">{t('pass.madeOn', { date: fmt(p.created_at.slice(0, 10)) })}</div></div>
          </div>
          <div className="card flat small"><Icon name="shield" size={16} /> {t('pass.verified', { date: fmt(p.expires_at.slice(0, 10)) })}</div>
          {d.since && <div className="small muted">{t('pass.since', { date: fmt(d.since) })}</div>}
          <div className="owner-bars" role="img" aria-label={t('pass.salesByMonth')}>
            {d.months.map((m) => (
              <div key={m.month} className="owner-bar" title={`${m.month}: ${formatMoney(n(m.sales))}`}>
                <span style={{ height: `${(n(m.sales) / max) * 100}%` }} /><small>{m.month.slice(5)}</small>
              </div>
            ))}
          </div>
          <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{rows.map(([k, v]) => <tr key={k} style={{ borderTop: '1px solid var(--separator, #ddd)' }}><td style={{ padding: '6px 0' }}>{k}</td><td className="num" style={{ textAlign: 'right' }}><b>{v}</b></td></tr>)}</tbody>
          </table>
          <div className="small muted">{t('pass.note')}</div>
          <div className="small muted">Ref {p.id.slice(0, 8)}</div>
        </div>
      </div>
    </div>
  );
}
