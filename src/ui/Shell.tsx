import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Icon } from './Icon';
import { haptic, useOverlay } from './overlay';
import { useApp } from '@/state/app';
import { syncNow } from '@/cloud/sync';

const TABS: [string, string, string][] = [['/', 'home', 'nav.home'], ['/credit', 'book', 'nav.credit'], ['/cash', 'cash', 'nav.cash'], ['/stock', 'box', 'nav.stock'], ['/more', 'grid', 'nav.more']];
const MORE_ROUTES = ['/more', '/money', '/groups', '/invoices', '/payments', '/health', '/report', '/team', '/audit', '/settings', '/assistant', '/reminders', '/help', '/plan', '/account'];

/**
 * iOS navigation: top-level screens show a large title that collapses into a translucent bar on scroll;
 * pushed screens (with a back link) show a compact centred title.
 */
export type GuideKey = 'home' | 'credit' | 'cash' | 'stock' | 'groups' | 'invoices' | 'money' | 'team' | 'health' | 'assistant';

/** Numbered how-it-works steps for a screen, opened from the (i) button in its top bar. */
export function GuideSheet({ k }: { k: GuideKey }) {
  const { t } = useTranslation();
  return (
    <ol className="guide" data-testid="guide">
      {(['s1', 's2', 's3', 's4'] as const).map((s, i) => <li key={s}><span className="n">{i + 1}</span><span>{t(`guide.${k}.${s}`)}</span></li>)}
    </ol>
  );
}

/** Shown on every screen while the phone is offline (everything keeps working locally). */
function NetBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online ? null : <div className="net-banner" role="status"><Icon name="offline" size={16} /> {t('pwa.offline')}</div>;
}

export function Page({ title, sub, back, right, children, fab, after, guide }: {
  title: string; sub?: string; back?: string; right?: ReactNode; children: ReactNode; fab?: ReactNode; after?: ReactNode; guide?: GuideKey;
}) {
  const { t } = useTranslation();
  const { openSheet } = useOverlay();
  const { sync, session } = useApp();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 36);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const pull = usePullToRefresh(sync.status !== 'off' && !!session, () => session && syncNow(session.orgId));
  const dot = sync.status !== 'off' && <i className={`sync-dot ${sync.status}`} aria-hidden="true" />;

  return (
    <div className="shell" {...pull.handlers}>
      <header className={`topbar ${back ? 'compact' : scrolled ? 'scrolled' : ''}`}>
        {back && <Link className="icon-btn" to={back} aria-label={t('common.back')}><Icon name="back" size={28} strokeWidth={2.2} /></Link>}
        {back ? <h1 className="nav-title">{title}</h1> : <span className="nav-title" aria-hidden="true">{title}</span>}
        <span className="spacer-x" />
        {guide && (
          <button className="icon-btn" onClick={() => openSheet(t(`guide.${guide}.title`), <GuideSheet k={guide} />)} aria-label={t('guide.open')} data-testid="guide-btn">
            <Icon name="info" size={22} />
          </button>
        )}
        {right}
      </header>
      <NetBanner />
      {!back && (
        <div className="large-title">
          <h1>{title}</h1>
          {sub && <div className="sub">{dot}{sub}</div>}
        </div>
      )}
      {back && sub && <div className="px-4 text-center text-[13px] text-muted-foreground">{dot}{sub}</div>}
      {pull.distance > 0 && (
        <div className="flex h-0 justify-center" aria-live="polite">
          <div className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-[13px] text-muted-foreground shadow" style={{ transform: `translateY(${Math.min(pull.distance, 80) - 30}px)` }}>
            <Icon name="refresh" size={14} className={pull.ready ? 'text-primary' : ''} />
            {sync.status === 'syncing' ? t('ux.refreshing') : pull.ready ? t('ux.release') : t('ux.pull')}
          </div>
        </div>
      )}
      <motion.main className="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
        {children}
      </motion.main>
      {fab}
      {after}
      <BottomNav />
    </div>
  );
}

/** Pull down at the top of a screen to sync now (only when the cloud is connected). */
function usePullToRefresh(enabled: boolean, onRefresh: () => unknown) {
  const start = useRef<number | null>(null);
  const [distance, setDistance] = useState(0);
  const ready = distance > 70;
  if (!enabled) return { distance: 0, ready: false, handlers: {} };
  return {
    distance, ready,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => { start.current = window.scrollY <= 0 ? e.touches[0].clientY : null; },
      onTouchMove: (e: React.TouchEvent) => { if (start.current !== null) setDistance(Math.max(0, (e.touches[0].clientY - start.current) * 0.5)); },
      onTouchEnd: () => { if (ready) { haptic(15); onRefresh(); } start.current = null; setDistance(0); },
    },
  };
}

function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = (to: string) => (to === '/' ? pathname === '/' : to === '/more' ? MORE_ROUTES.some((r) => pathname.startsWith(r)) : pathname.startsWith(to));
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        {TABS.map(([to, icon, label]) => {
          const on = active(to);
          return (
            <NavLink key={to} to={to} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => haptic(6)}>
              <Icon name={icon} size={25} strokeWidth={on ? 2.3 : 1.8} />
              <span>{t(label)}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
