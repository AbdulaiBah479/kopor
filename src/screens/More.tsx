import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { health } from '@/domain/health';
import { isPro } from '@/domain/plan';

export const ORG_TYPES = ['shop', 'trader', 'wholesale', 'pharmacy', 'restaurant', 'salon', 'tailor', 'transport', 'farm', 'services', 'school', 'church', 'association', 'personal', 'other'];

function MenuItem({ to, icon, title, sub }: { to: string; icon: string; title: string; sub: string }) {
  return (
    <Link className="item" to={to}>
      <div className="avatar" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name={icon} size={18} /></div>
      <div className="main"><div className="t">{title}</div><div className="s">{sub}</div></div>
      <Icon name="chev" />
    </Link>
  );
}

export function More() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const h = health(book);
  return (
    <Page title={t('nav.more')}>
      <div className="list">
        <MenuItem to="/assistant" icon="spark" title={t('more.assistant')} sub={t('more.assistantSub')} />
        <MenuItem to="/reminders" icon="bell" title={t('settings.reminders')} sub={t('more.remindersSub')} />
        <MenuItem to="/groups" icon="users" title={t('groups.title')} sub={t('more.groupsSub', { count: book.groups.length })} />
        <MenuItem to="/invoices" icon="file" title={t('inv.title')} sub={t('more.invoicesSub', { count: book.invoices.length })} />
        {can('payments') && <MenuItem to="/payments" icon="phone" title={t('more.payments')} sub={t('more.paymentsSub')} />}
        {can('reports') && <MenuItem to="/health" icon="pulse" title={t('health.title')} sub={t('more.healthSub', { score: h.score })} />}
        <MenuItem to="/team" icon="store" title={t('team.title')} sub={t('more.teamSub', { count: book.members.filter((m) => m.active).length })} />
        <MenuItem to="/settings" icon="sliders" title={t('settings.title')} sub={t('more.settingsSub')} />
        <MenuItem to="/plan" icon="crown" title={t('plan.title')} sub={isPro(book.org) ? t('plan.proActive') : t('plan.freeSub')} />
        <MenuItem to="/help" icon="help" title={t('help.title')} sub={t('help.sub')} />
      </div>
      <div className="card flat small">{t('more.offlineNote')}</div>
    </Page>
  );
}
