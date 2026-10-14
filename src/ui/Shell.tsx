import { useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Icon } from './Icon';
import { haptic } from './overlay';
import { useApp } from '@/state/app';
import { syncNow } from '@/cloud/sync';

const TABS: [string, string, string][] = [['/', 'home', 'nav.home'], ['/credit', 'book', 'nav.credit'], ['/cash', 'cash', 'nav.cash'], ['/stock', 'box', 'nav.stock'], ['/more', 'grid', 'nav.more']];
const MORE_ROUTES = ['/more', '/groups', '/invoices', '/payments', '/health', '/report', '/team', '/audit', '/settings', '/assistant', '/reminders', '/help', '/plan'];

export function Page({ title, sub, back, right, children, fab, after }: {
  title: string; sub?: string; back?: string; right?: ReactNode; children: ReactNode; fab?: ReactNode; after?: ReactNode;
}) {
  const { t } = useTranslation();
  const { sync, session } = useApp();
  const pull = usePullToRefresh(sync.status !== 'off' && !!session, () => session && syncNow(session.orgId));
  return (
    <div className="shell" {...pull.handlers}>
      <header className="topbar">
        {back && <Link className="icon-btn" to={back} aria-label={t('common.back')}><Icon name="back" size={24} /></Link>}
        <h1>{title}{sub && <span className="sub">{sync.status !== 'off' && <i className={`sync-dot ${sync.status}`} aria-hidden="true" />}{sub}</span>}</h1>
        {right}
      </header>
      {pull.distance > 0 && (
        <div className="flex h-0 justify-center" aria-live="polite">
          <div className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow" style={{ transform: `translateY(${Math.min(pull.distance, 80) - 30}px)` }}>
            <Icon name="refresh" size={14} className={pull.ready ? 'text-primary' : ''} />
            {sync.status === 'syncing' ? t('ux.refreshing') : pull.ready ? t('ux.release') : t('ux.pull')}
          </div>
        </div>
      )}
      <motion.main className="content" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
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
              {on && <motion.span layoutId="nav-pill" className="nav-pill" style={{ left: 6, right: 6 }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <Icon name={icon} size={22} strokeWidth={on ? 2.4 : 2} />
              <span className="relative">{t(label)}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
