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
import { startProCheckout } from '@/cloud/account-extra';

export function Plan() {
  const { t } = useTranslation();
  const book = useBook();
  const { can, ctx } = useApp();
  const { fail } = useOverlay();
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
  return (
    <Page title={t('plan.title')} sub={pro ? t('plan.proUntil', { date: fmt(isoDate(new Date(book.org.plan_until ?? 0))) }) : t('plan.freeSub')} back="/more">
      <div className="hero">
        <div className="label">{pro ? t('plan.proActive') : t('plan.current')}</div>
        <div className="big">{pro ? 'Kopor Pro' : 'Kopor Free'}</div>
        <div className="small" style={{ opacity: 0.9 }}>{t('plan.pitch')}</div>
      </div>
      <div className="card">
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ textAlign: 'left' }} /><th>Free</th><th>Pro</th></tr></thead>
          <tbody>{rows.map(([f, a, b]) => <tr key={f} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '8px 0' }}>{f}</td><td style={{ textAlign: 'center' }}>{a}</td><td style={{ textAlign: 'center', fontWeight: 700 }}>{b}</td></tr>)}</tbody>
        </table>
      </div>
      {can('business') ? (
        <div className="stack">
          <ActionButton icon="crown" className="btn primary block" label={t('plan.buyMonth', { price: formatMoney(PRO_PRICE_MINOR) })} run={() => buy(1)} />
          <ActionButton icon="crown" className="btn block" label={t('plan.buyYear', { price: formatMoney(PRO_PRICE_MINOR * 10) })} run={() => buy(12)} />
          <div className="small muted"><Icon name="shield" size={14} /> {t('plan.payNote')}</div>
        </div>
      ) : <div className="small muted">{t('plan.ownerOnly')}</div>}
    </Page>
  );
}
