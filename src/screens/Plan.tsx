import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { useDate } from '@/ui/widgets';
import { ActionButton } from '@/ui/extras';
import { formatMoney } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import { FREE_LIMITS, PRO_PRICE_MINOR, isPro, AI_PER_DAY } from '@/domain/plan';
import { proStatus, startProCheckout, startProTrial } from '@/cloud/account-extra';
import { syncNow } from '@/cloud/sync';
import { waLink } from '@/lib/phone';

const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined;

export function Plan() {
  const { t } = useTranslation();
  const book = useBook();
  const { can, ctx, sync } = useApp();
  const { fail, toast } = useOverlay();
  // Whether paying is open yet (Kopor's own Monime account); null while checking or offline.
  const [payments, setPayments] = useState<boolean | null>(null);
  useEffect(() => { proStatus().then((s) => setPayments(s.payments)).catch(() => setPayments(null)); }, []);
  const cloud = sync.status !== 'off';
  const { fmt } = useDate();
  const pro = isPro(book.org);
  const rows: [string, string, string][] = [
    [t('plan.f.records'), '✓', '✓'],
    [t('plan.f.offline'), '✓', '✓'],
    [t('plan.f.branches'), String(FREE_LIMITS.branches), t('plan.unlimited')],
    [t('plan.f.staff'), String(FREE_LIMITS.staff), t('plan.unlimited')],
    [t('plan.f.ai'), `${AI_PER_DAY.free}/day`, `${AI_PER_DAY.pro}/day`],
    [t('plan.f.support'), '—', '✓'],
  ];
  const buy = async (months: 1 | 12) => {
    try { const { url } = await startProCheckout(ctx.orgId, months); window.location.href = url; } catch (e) { fail(e); }
  };
  const trial = async () => {
    try { await startProTrial(ctx.orgId); await syncNow(ctx.orgId); toast(t('plan.trialOn')); } catch (e) { fail(e); }
  };
  return (
    <Page title={t('plan.title')} sub={pro ? t('plan.proUntil', { date: fmt(isoDate(new Date(book.org.plan_until ?? 0))) }) : t('plan.freeSub')} back="/more">
      <div className="hero">
        <div className="label">{pro ? t('plan.proActive') : t('plan.current')}</div>
        <div className="big">{pro ? 'Kopor Pro' : 'Kopor Free'}</div>
        <div className="small" style={{ opacity: 0.9 }}>{t('plan.pitch')}</div>
      </div>
      <div className="card">
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ textAlign: 'left' }}><span className="sr-only">{t('plan.current')}</span></th><th>Free</th><th>Pro</th></tr></thead>
          <tbody>{rows.map(([f, a, b]) => <tr key={f} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '8px 0' }}>{f}</td><td style={{ textAlign: 'center' }}>{a}</td><td style={{ textAlign: 'center', fontWeight: 700 }}>{b}</td></tr>)}</tbody>
        </table>
      </div>
      {!can('business') ? <div className="small muted">{t('plan.ownerOnly')}</div>
        : !cloud ? <div className="alert info" data-testid="plan-signin"><Icon name="cloud" /><div>{t('plan.signInFirst')}</div></div>
        : (
        <div className="stack">
          {!pro && !book.org.pro_trial_at && <ActionButton icon="spark" className="btn primary block" label={t('plan.trial')} run={trial} />}
          {payments === false ? (
            <div className="alert info" data-testid="plan-soon"><Icon name="info" /><div>{t('plan.soon')}
              {SUPPORT_WHATSAPP && <><br /><a href={waLink(SUPPORT_WHATSAPP, t('plan.soonWa', { name: book.org.name }))} target="_blank" rel="noopener noreferrer">{t('help.contact')}</a></>}</div></div>
          ) : <>
            <ActionButton icon="crown" className={`btn block${pro || book.org.pro_trial_at ? ' primary' : ''}`} label={t('plan.buyMonth', { price: formatMoney(PRO_PRICE_MINOR) })} run={() => buy(1)} />
            <ActionButton icon="crown" className="btn block" label={t('plan.buyYear', { price: formatMoney(PRO_PRICE_MINOR * 10) })} run={() => buy(12)} />
            <div className="small muted"><Icon name="shield" size={14} /> {t('plan.payNote')}</div>
          </>}
        </div>
      )}
    </Page>
  );
}
