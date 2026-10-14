import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { useApp } from '@/state/app';

const TABS: [string, string, string][] = [['/', 'home', 'nav.home'], ['/credit', 'book', 'nav.credit'], ['/cash', 'cash', 'nav.cash'], ['/stock', 'box', 'nav.stock'], ['/more', 'grid', 'nav.more']];
const MORE_ROUTES = ['/more', '/groups', '/invoices', '/payments', '/health', '/report', '/team', '/audit', '/settings', '/assistant', '/reminders'];

export function Page({ title, sub, back, right, children, fab, after }: {
  title: string; sub?: string; back?: string; right?: ReactNode; children: ReactNode; fab?: ReactNode; after?: ReactNode;
}) {
  const { t } = useTranslation();
  const { sync } = useApp();
  return (
    <div className="shell">
      <header className="topbar">
        {back && <Link className="icon-btn" to={back} aria-label={t('common.back')}><Icon name="back" /></Link>}
        <h1>{title}{sub && <span className="sub">{sync.status !== 'off' && <i className={`sync-dot ${sync.status}`} aria-hidden="true" />}{sub}</span>}</h1>
        {right}
      </header>
      <main className="content">{children}</main>
      {fab}
      {after}
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = (to: string) => (to === '/' ? pathname === '/' : to === '/more' ? MORE_ROUTES.some((r) => pathname.startsWith(r)) : pathname.startsWith(to));
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        {TABS.map(([to, icon, label]) => (
          <NavLink key={to} to={to} className={active(to) ? 'on' : ''} aria-current={active(to) ? 'page' : undefined}>
            <Icon name={icon} size={22} />{t(label)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
