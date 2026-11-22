import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { health } from '@/domain/health';
import { isPro } from '@/domain/plan';
import { EXTRAS, extraOn, groupsFirst, setShowAllFeatures, showAllFeatures, type Extra } from '@/domain/features';
import { useInstall, APP_URL, type InstallHow } from '@/features/pwa';
import { shareText } from '@/lib/share';
import { useOverlay } from '@/ui/overlay';
import { AppearancePanel } from '@/ui/Appearance';
import { useEffect, useState } from 'react';
import { isAppAdmin } from '@/cloud/admin';
import { Copyright } from '@/ui/Copyright';
import { Suspense, type ReactNode } from 'react';
import { lazyRetry } from '@/ui/lazy';
const ReportSheet = lazyRetry(() => import('./Report').then((m) => ({ default: m.ReportSheet })));

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

/** A titled group of menu rows. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (<><div className="section-title"><span>{title}</span></div><div className="list">{children}</div></>);
}

const EXTRA_ROUTE: Record<Extra, { to: string; icon: string; tile: string }> = {
  agent: { to: '/agent', icon: 'phone', tile: 'orange' }, groups: { to: '/groups', icon: 'users', tile: 'orange' },
  gst: { to: '/gst', icon: 'receipt', tile: 'blue' }, staff: { to: '/staff', icon: 'users', tile: 'indigo' },
};
/** Screens this kind of business does not usually need: still one tap away, and a switch to show them all in the menu. */
function ExtrasSheet({ hidden }: { hidden: Extra[] }) {
  const { t } = useTranslation();
  const { closeSheet } = useOverlay();
  return (
    <div className="stack">
      <div className="small muted">{t('morex.extraHelp')}</div>
      <div className="list">
        {hidden.map((f) => (
          <Link key={f} className="item" to={EXTRA_ROUTE[f].to} onClick={closeSheet}>
            <span className="tile" style={{ background: `var(--tile-${EXTRA_ROUTE[f].tile})` }}><Icon name={EXTRA_ROUTE[f].icon} size={18} strokeWidth={2.2} /></span>
            <div className="main"><div className="t">{t(`morex.f.${f}`)}</div><div className="s">{t(`morex.fs.${f}`)}</div></div>
            <Icon name="chev" size={18} className="text-subtle" />
          </Link>
        ))}
      </div>
      <button type="button" className="btn ghost block" data-testid="show-all-features" onClick={() => { setShowAllFeatures(true); closeSheet(); window.location.reload(); }}>{t('morex.showAll')}</button>
    </div>
  );
}

const APK_URL = 'https://github.com/AbdulaiBah479/kopor/releases/download/test-latest/kopor-test.apk';

/** Install steps for browsers without a one-tap install, plus the Android app download. */
function InstallSteps({ how }: { how: InstallHow }) {
  const { t } = useTranslation();
  return (
    <div className="stack" data-testid="install-steps">
      <ol className="steps">{(t(`pwa.how.${how}`, { returnObjects: true }) as string[]).map((s) => <li key={s}>{s}</li>)}</ol>
      <div className="small muted">{t('pwa.howAfter')}</div>
      {how === 'android' && <a className="btn" href={APK_URL} target="_blank" rel="noopener"><Icon name="download" size={18} /> {t('pwa.apk')}</a>}
    </div>
  );
}

export function More() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const h = health(book);
  const { sync } = useApp();
  const { install, how } = useInstall();
  const { openSheet } = useOverlay();
  const [admin, setAdmin] = useState(false);
  useEffect(() => { isAppAdmin().then(setAdmin); }, [sync.status]);
  const all = showAllFeatures();
  const on = (f: Extra) => all || extraOn(book, f);
  // Hidden extras the person is allowed to use (Staff needs 'record', GST needs 'reports').
  const hidden = EXTRAS.filter((f) => !on(f) && (f !== 'staff' || can('record')) && (f !== 'gst' || can('reports')));
  const first = groupsFirst(book);
  const groupsSection = (
    <Section title={t('morex.saving')}>
      {on('groups') && <MenuItem to="/groups" icon="users" tile="orange" title={t('groups.title')} sub={t('more.groupsSub', { count: book.groups.length })} />}
      <MenuItem to="/savings" icon="wallet" tile="green" title={t('save.title')} sub={t('save.menuSub')} />
      {can('business') && <MenuItem to="/bills" icon="calendar" tile="red" title={t('bills.title')} sub={t('bills.menuSub')} />}
    </Section>
  );
  return (
    <Page title={t('nav.more')}>
      {admin && (
        <div className="list">
          <MenuItem to="/admin" icon="crown" tile="indigo" title={t('owner.title')} sub={t('owner.sub')} />
        </div>
      )}
      <Section title={t('morex.money')}>
        <MenuItem to="/money" icon="swap" tile="green" title={t('money.title')} sub={t('morex.moneySub')} />
        <MenuItem to="/invoices" icon="file" tile="blue" title={t('inv.title')} sub={t('more.invoicesSub', { count: book.invoices.length })} />
      </Section>
      {first && groupsSection}
      <Section title={t('morex.selling')}>
        <MenuItem to="/reminders" icon="bell" tile="red" title={t('settings.reminders')} sub={t('more.remindersSub')} />
        {can('edit') && <MenuItem to="/messages" icon="sms" tile="blue" title={t('msg.title')} sub={t('msg.menuSub')} />}
        <MenuItem to="/layaway" icon="box" tile="green" title={t('lay.title')} sub={t('lay.menuSub')} />
        {on('agent') && <MenuItem to="/agent" icon="phone" tile="orange" title={t('agent.title')} sub={t('agent.menuSub')} />}
      </Section>
      {!first && groupsSection}
      <Section title={t('morex.staff')}>
        {on('staff') && can('record') && <MenuItem to="/staff" icon="users" tile="indigo" title={t('staff.title')} sub={t('staff.menuSub')} />}
        <MenuItem to="/team" icon="store" tile="teal" title={t('team.title')} sub={t('more.teamSub', { count: book.members.filter((m) => m.active).length })} />
      </Section>
      <Section title={t('morex.reports')}>
        {can('reports') && <MenuItem to="/health" icon="pulse" tile="pink" title={t('healthx.title')} sub={t('more.healthSub', { score: h.score })} />}
        {can('reports') && <MenuItem to="/pnl" icon="trendUp" tile="green" title={t('pnl.title')} sub={t('pnl.sub')} />}
        {can('reports') && on('gst') && <MenuItem to="/gst" icon="receipt" tile="blue" title={t('gst.title')} sub={t('gst.menuSub')} />}
        {can('reports') && <MenuItem to="/watch" icon="shield" tile="red" title={t('watch.title')} sub={t('watch.menuSub')} />}
        <MenuItem to="/assistant" icon="spark" tile="indigo" title={t('more.assistant')} sub={t('more.assistantSub')} />
      </Section>
      <Section title={t('morex.settings')}>
        <MenuItem to="/account" icon="cloud" tile="blue" title={t('settings.cloud')}
          sub={sync.status === 'off' ? t('settings.syncOff') : sync.status === 'error' ? t('settings.syncError', { error: sync.error ?? '' }).slice(0, 60)
            : sync.status === 'syncing' ? t('settings.syncing') : sync.lastSync ? t('settings.lastSync', { time: new Date(sync.lastSync).toLocaleTimeString() }) : t('settings.syncing')} />
        <MenuItem to="/plan" icon="crown" tile="yellow" title={t('plan.title')} sub={isPro(book.org) ? t('plan.proActive') : t('plan.freeSub')} />
        <button className="item" onClick={() => openSheet(t('look.title'), <AppearancePanel />)} data-testid="appearance-row">
          <span className="tile" style={{ background: 'var(--tile-purple)' }}><Icon name="palette" size={18} strokeWidth={2.2} /></span>
          <div className="main"><div className="t">{t('look.title')}</div><div className="s">{t('look.sub')}</div></div>
          <Icon name="chev" size={18} className="text-subtle" />
        </button>
        <MenuItem to="/settings" icon="sliders" tile="gray" title={t('settings.title')} sub={t('more.settingsSub')} />
        <MenuItem to="/help" icon="help" tile="blue" title={t('help.title')} sub={t('help.sub')} />
        <button className="item" data-testid="report-row" onClick={() => openSheet(t('report.title'), <Suspense fallback={t('common.loading')}><ReportSheet /></Suspense>)}>
          <span className="tile" style={{ background: 'var(--tile-red)' }}><Icon name="alert" size={18} strokeWidth={2.2} /></span>
          <div className="main"><div className="t">{t('report.title')}</div><div className="s">{t('report.sub')}</div></div>
          <Icon name="chev" size={18} className="text-subtle" />
        </button>
        {hidden.length > 0 && (
          <button className="item" data-testid="more-features" onClick={() => openSheet(t('morex.extraTitle'), <ExtrasSheet hidden={hidden} />)}>
            <span className="tile" style={{ background: 'var(--tile-gray)' }}><Icon name="grid" size={18} strokeWidth={2.2} /></span>
            <div className="main"><div className="t">{t('morex.extra', { n: hidden.length })}</div><div className="s">{hidden.map((f) => t(`morex.f.${f}`)).join(', ')}</div></div>
            <Icon name="chev" size={18} className="text-subtle" />
          </button>
        )}
      </Section>
      <div className="list">
        {how && (
          <button className="item" onClick={() => (how === 'prompt' ? install() : openSheet(t('pwa.install'), <InstallSteps how={how} />))} data-testid="install">
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
      <Copyright />
    </Page>
  );
}
