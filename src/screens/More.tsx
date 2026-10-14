import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { health } from '@/domain/health';
import { isPro } from '@/domain/plan';
import { useInstall, APP_URL } from '@/features/pwa';
import { shareText } from '@/lib/share';
import { useOverlay } from '@/ui/overlay';
import { AppearancePanel } from '@/ui/Appearance';
import { useEffect, useState } from 'react';
import { isAppAdmin } from '@/cloud/admin';

export const ORG_TYPES = ['shop', 'trader', 'wholesale', 'pharmacy', 'restaurant', 'salon', 'tailor', 'transport', 'farm', 'services', 'school', 'church', 'association', 'personal', 'other'];

/** iOS Settings-style row: coloured icon tile, title, detail, chevron. */
function MenuItem({ to, icon, tile, title, sub }: { to: string; icon: string; tile: string; title: string; sub: string }) {
  return (
    <Link className="item" to={to}>
      <span className="tile" style={{ background: `var(--tile-${tile})` }}><Icon name={icon} size={18} strokeWidth={2.2} /></span>
      <div className="main"><div className="t">{title}</div><div className="s">{sub}</div></div>
      <Icon name="chev" size={18} className="text-subtle" />
    </Link>
  );
}

export function More() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const h = health(book);
  const { sync } = useApp();
  const { canInstall, install } = useInstall();
  const { openSheet } = useOverlay();
  const [admin, setAdmin] = useState(false);
  useEffect(() => { isAppAdmin().then(setAdmin); }, [sync.status]);
  return (
    <Page title={t('nav.more')}>
      {admin && (
        <div className="list">
          <MenuItem to="/admin" icon="crown" tile="indigo" title={t('owner.title')} sub={t('owner.sub')} />
        </div>
      )}
      <div className="list">
        <MenuItem to="/money" icon="swap" tile="green" title={t('money.title')} sub={t('money.sub')} />
        <MenuItem to="/account" icon="cloud" tile="blue" title={t('settings.cloud')}
          sub={sync.status === 'off' ? t('settings.syncOff') : sync.status === 'error' ? t('settings.syncError', { error: sync.error ?? '' }).slice(0, 60)
            : sync.status === 'syncing' ? t('settings.syncing') : sync.lastSync ? t('settings.lastSync', { time: new Date(sync.lastSync).toLocaleTimeString() }) : t('settings.syncing')} />
      </div>
      <div className="list">
        <MenuItem to="/assistant" icon="spark" tile="indigo" title={t('more.assistant')} sub={t('more.assistantSub')} />
        <MenuItem to="/reminders" icon="bell" tile="red" title={t('settings.reminders')} sub={t('more.remindersSub')} />
      </div>
      <div className="list">
        <MenuItem to="/groups" icon="users" tile="orange" title={t('groups.title')} sub={t('more.groupsSub', { count: book.groups.length })} />
        <MenuItem to="/invoices" icon="file" tile="blue" title={t('inv.title')} sub={t('more.invoicesSub', { count: book.invoices.length })} />
        {can('payments') && <MenuItem to="/payments" icon="wallet" tile="green" title={t('more.payments')} sub={t('more.paymentsSub')} />}
        {can('reports') && <MenuItem to="/health" icon="pulse" tile="pink" title={t('health.title')} sub={t('more.healthSub', { score: h.score })} />}
      </div>
      <div className="list">
        <MenuItem to="/team" icon="store" tile="teal" title={t('team.title')} sub={t('more.teamSub', { count: book.members.filter((m) => m.active).length })} />
        <MenuItem to="/plan" icon="crown" tile="yellow" title={t('plan.title')} sub={isPro(book.org) ? t('plan.proActive') : t('plan.freeSub')} />
        <button className="item" onClick={() => openSheet(t('look.title'), <AppearancePanel />)} data-testid="appearance-row">
          <span className="tile" style={{ background: 'var(--tile-purple)' }}><Icon name="palette" size={18} strokeWidth={2.2} /></span>
          <div className="main"><div className="t">{t('look.title')}</div><div className="s">{t('look.sub')}</div></div>
          <Icon name="chev" size={18} className="text-subtle" />
        </button>
        <MenuItem to="/settings" icon="sliders" tile="gray" title={t('settings.title')} sub={t('more.settingsSub')} />
        <MenuItem to="/help" icon="help" tile="blue" title={t('help.title')} sub={t('help.sub')} />
      </div>
      <div className="list">
        {canInstall && (
          <button className="item" onClick={install} data-testid="install">
            <span className="tile" style={{ background: 'var(--tile-indigo)' }}><Icon name="install" size={18} strokeWidth={2.2} /></span>
            <div className="main"><div className="t">{t('pwa.install')}</div><div className="s">{t('pwa.installHelp')}</div></div>
          </button>
        )}
        <button className="item" onClick={() => shareText(t('pwa.shareMsg', { link: APP_URL }))} data-testid="share-app">
          <span className="tile" style={{ background: 'var(--tile-orange)' }}><Icon name="share" size={18} strokeWidth={2.2} /></span>
          <div className="main"><div className="t">{t('pwa.share')}</div><div className="s">{APP_URL.replace(/^https:\/\//, '')}</div></div>
        </button>
      </div>
      <p className="px-4 text-[13px] text-muted-foreground">{t('more.offlineNote')}</p>
    </Page>
  );
}
