// Owner dashboard for whoever runs Kopor: how many people use it, how active they are, AI use and payments.
// Only phone numbers listed in the KOPOR_ADMIN_PHONES server secret can open it (checked by the admin function).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { adminCall as call } from '@/cloud/admin';

interface Stats {
  accounts: number; accounts_week: number; businesses: number; businesses_active_week: number; staff: number; pro: number;
  records_week: number; money_recorded_week: number; ai_today: number; payments_completed: number; locked_accounts: number;
  signups_14d: { day: string; n: number }[]; business_types: Record<string, number>;
}

const LINKS: [string, string, string][] = [
  ['owner.linkUsers', 'users', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/auth/users'],
  ['owner.linkData', 'list', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/editor'],
  ['owner.linkLogs', 'pulse', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/functions'],
  ['owner.linkDeploys', 'upload', 'https://github.com/AbdulaiBah479/kopor/actions'],
  ['owner.linkAi', 'spark', 'https://console.groq.com/dashboard/usage'],
];

export function Owner() {
  const { t, i18n } = useTranslation();
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [at, setAt] = useState('');
  const load = () => call<{ stats: Stats; at: string }>('stats').then((r) => { setS(r.stats); setAt(r.at); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const max = Math.max(1, ...(s?.signups_14d.map((d) => d.n) ?? [1]));
  const tile = (label: string, value: string | number, sub?: string) => (
    <div className="stat"><div className="k">{label}</div><div className="v num">{value}</div>{sub && <div className="small muted">{sub}</div>}</div>
  );
  return (
    <Page title={t('owner.title')} sub={t('owner.sub')} back="/more"
      right={<button className="icon-btn" onClick={load} aria-label={t('ux.refreshing')}><Icon name="refresh" size={20} /></button>}>
      {err && <Empty icon="lock" title={err} />}
      {s && (
        <>
          <div className="grid2">
            {tile(t('owner.accounts'), s.accounts, t('owner.thisWeek', { n: s.accounts_week }))}
            {tile(t('owner.businesses'), s.businesses, t('owner.activeWeek', { n: s.businesses_active_week }))}
            {tile(t('owner.pro'), s.pro, t('owner.staff', { n: s.staff }))}
            {tile(t('owner.aiToday'), s.ai_today, t('owner.locked', { n: s.locked_accounts }))}
            {tile(t('owner.records'), s.records_week, formatMoney(s.money_recorded_week))}
            {tile(t('owner.payments'), s.payments_completed)}
          </div>
          <div className="card">
            <h3>{t('owner.signups')}</h3>
            <div className="owner-bars" role="img" aria-label={t('owner.signups')}>
              {s.signups_14d.map((d) => (
                <div key={d.day} className="owner-bar" title={`${d.day}: ${d.n}`}>
                  <span style={{ height: `${(d.n / max) * 100}%` }} />
                  <small>{new Date(d.day).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric' })}</small>
                </div>
              ))}
            </div>
          </div>
          {Object.keys(s.business_types).length > 0 && (
            <div className="list">
              {Object.entries(s.business_types).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                <div key={type} className="item"><div className="main"><div className="t">{t(`orgTypes.${type}`, { defaultValue: type })}</div></div><div className="amt num">{n}</div></div>
              ))}
            </div>
          )}
          <div className="section-title"><span>{t('owner.tools')}</span></div>
          <div className="list">
            {LINKS.map(([key, icon, href]) => (
              <a key={href} className="item" href={href} target="_blank" rel="noopener noreferrer">
                <span className="tile" style={{ background: 'var(--tile-gray)' }}><Icon name={icon} size={18} /></span>
                <div className="main"><div className="t">{t(key)}</div></div><Icon name="chev" size={18} className="text-subtle" />
              </a>
            ))}
          </div>
          <div className="small muted" style={{ textAlign: 'center' }}>{t('owner.updated', { time: new Date(at).toLocaleString() })}</div>
        </>
      )}
    </Page>
  );
}
