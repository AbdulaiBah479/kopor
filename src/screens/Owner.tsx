// Owner dashboard (back office) for whoever runs Kopor: how the service is used and whether it is healthy; every
// account and every business (with a detail page); money through Monime; AI use; announcements on everyone's Home;
// the reports inbox; and support tools (find an account, unlock, recovery code, Pro for testers, suspend).
// Only phone numbers listed in the KOPOR_ADMIN_PHONES server secret can open it (checked by the admin function).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, Seg } from '@/ui/widgets';
import { useOverlay } from '@/ui/overlay';
import { formatMoney } from '@/lib/money';
import { waLink } from '@/lib/phone';
import { downloadBlob } from '@/lib/share';
import { adminCall as call } from '@/cloud/admin';

interface Day { day: string; n?: number; active?: number; records?: number }
interface Stats {
  accounts: number; accounts_week: number; businesses: number; businesses_active_week: number; staff: number; pro: number;
  records_week: number; money_recorded_week: number; ai_today: number; payments_completed: number; locked_accounts: number;
  signups_14d: Day[]; activity_14d?: Day[]; business_types: Record<string, number>; reports_waiting?: number;
}
interface Health { ai: string[]; voice: boolean; voice_backup: boolean; pin_pepper: boolean; payments: boolean; pro_billing: boolean }
interface Report { id: string; created_at: string; kind: string; message: string; contact: string; about: string; status: string; app_info: Record<string, unknown> }
interface Biz { id: string; name: string; type: string; role: string; plan: string; plan_until: number | null; records: number; last_record: number | null }
interface Account {
  phone: string; name: string | null; created_at: string; last_sign_in_at: string | null; locked_until: string | null; wrong_pins: number | null;
  has_recovery_code: boolean; banned_until?: string | null; businesses: Biz[];
}
interface LogRow { at: string; admin_phone: string; action: string; target: string; detail: string }
interface UserRow { id: string; phone: string | null; name: string | null; created_at: string; last_sign_in_at: string | null; banned_until: string | null; verified?: boolean; businesses: { id: string; name: string; role: string }[] }
interface OrgRow {
  id: string; name: string; type: string; owner_name: string; owner_phone: string | null; phone: string; plan: string; plan_until: number | null; created_at: number;
  staff: number; branches: number; records: number; records_30d: number; money_in_30d: number; last_record: number | null; payments: 'own' | 'easy' | null;
}
interface OrgDetail {
  org: { id: string; name: string; type: string; owner_name: string; phone: string; address: string; momo_number: string; plan: string; plan_until: number | null; created_at: number; owner_phone: string | null };
  members: { name: string; role: string; phone: string; active: boolean; account: string | null; last_sign_in_at: string | null }[];
  branches: string[];
  counts: { customers: number; suppliers: number; products: number; records: number; invoices_unpaid: number; groups: number };
  money_30d: { in: number; out: number }; credit_outstanding: number; activity_14d: Day[];
  audit: { member_name: string; action: string; entity: string; summary: string; at: number }[];
  payments: { kind: string; amount: number; status: string; note: string; created_at: number }[];
  payments_mode: 'own' | 'easy' | null; ai_14d: number;
}
interface Money {
  received_30d: number; sent_30d: number; by_status: Record<string, number>; own_accounts: number; easy_accounts: number; daily_14d: Day[];
  latest: { kind: string; amount: number; status: string; note: string; created_at: number; business: string; org_id: string }[];
}
interface Ai { daily_14d: Day[]; top_week: { org_id: string; name: string; n: number }[]; guests_today: number }
interface Note { id: string; created_at: string; message: string; level: string; active: boolean; expires_at: string | null; created_by: string; live?: boolean }

const LINKS: [string, string, string][] = [
  ['owner.linkUsers', 'users', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/auth/users'],
  ['owner.linkData', 'list', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/editor'],
  ['owner.linkLogs', 'pulse', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/functions'],
  ['owner.linkDeploys', 'upload', 'https://github.com/AbdulaiBah479/kopor/actions'],
  ['owner.linkAi', 'spark', 'https://console.groq.com/dashboard/usage'],
];

type Tab = 'overview' | 'users' | 'businesses' | 'money' | 'ai' | 'news' | 'support' | 'reports';

const day = (v: string | number | null | undefined, never = '—') => (v ? new Date(v).toLocaleDateString() : never);
const isOn = (until: string | number | null | undefined) => !!until && new Date(until).getTime() > Date.now();

/** Save rows as a CSV file (opens in Excel or Google Sheets). */
function csv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  // Names are typed by users: a leading = + - @ would run as a formula in Excel, so such cells start with ' (text).
  const cell = (v: unknown) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), `kopor-${name}-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function Owner() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const [s, setS] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState('');
  const [at, setAt] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [org, setOrg] = useState<string | null>(null);        // business detail open
  const [findPhone, setFindPhone] = useState('');             // Users -> Support
  const loadReports = () => call<{ reports: Report[] }>('reports').then((r) => setReports(r.reports)).catch(() => {});
  const load = () => call<{ stats: Stats; health: Health; at: string }>('stats')
    .then((r) => { setS(r.stats); setHealth(r.health); setAt(r.at); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); loadReports(); }, []);
  const waiting = s?.reports_waiting ?? 0;
  const go = (next: Tab) => { setOrg(null); setTab(next); };
  const openOrg = (id: string) => setOrg(id);
  const support = (phone: string) => { setFindPhone(phone); go('support'); };

  return (
    <Page title={t('owner.title')} sub={t('owner.sub')} back="/more"
      right={<button className="icon-btn" onClick={() => { load(); loadReports(); }} aria-label={t('ux.refreshing')}><Icon name="refresh" size={20} /></button>}>
      {err && <Empty icon="lock" title={err} />}
      {s && (
        <>
          <div className="owner-tabs">
            <Seg<Tab> value={tab} onChange={go} options={[
              ['overview', t('admin.overview')], ['users', t('admin.users')], ['businesses', t('admin.businesses')], ['money', t('admin.money')],
              ['ai', t('admin.ai')], ['news', t('admin.news')], ['support', t('admin.support')],
              ['reports', waiting ? `${t('admin.reports')} (${waiting})` : t('admin.reports')]]} />
          </div>
          {org ? <OrgView id={org} onBack={() => setOrg(null)} onSupport={support} /> : (
            <>
              {tab === 'overview' && <Overview s={s} health={health} />}
              {tab === 'users' && <Users onPick={support} onOrg={openOrg} />}
              {tab === 'businesses' && <Businesses onPick={openOrg} />}
              {tab === 'money' && <MoneyTab onOrg={openOrg} />}
              {tab === 'ai' && <AiTab onOrg={openOrg} />}
              {tab === 'news' && <News />}
              {tab === 'support' && <Support initialPhone={findPhone} onOrg={openOrg} />}
              {tab === 'reports' && <Inbox reports={reports} reload={() => { loadReports(); load(); }} onError={setErr} />}
            </>
          )}
          <div className="small muted" style={{ textAlign: 'center' }}>{t('owner.updated', { time: new Date(at).toLocaleString() })}</div>
        </>
      )}
    </Page>
  );
}

function Bars({ title, days, value, money }: { title: string; days: Day[]; value: (d: Day) => number; money?: boolean }) {
  const { i18n } = useTranslation();
  const max = Math.max(1, ...days.map(value));
  const fmt = (n: number) => (money ? formatMoney(n) : String(n));
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="owner-bars" role="img" aria-label={`${title}: ${days.map((d) => fmt(value(d))).join(', ')}`}>
        {days.map((d) => (
          <div key={d.day} className="owner-bar" title={`${d.day}: ${fmt(value(d))}`}>
            <span style={{ height: `${(value(d) / max) * 100}%` }} />
            <small>{new Date(d.day).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric' })}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

const tile = (label: string, value: string | number, sub?: string) => (
  <div className="stat" key={label}><div className="k">{label}</div><div className="v num">{value}</div>{sub && <div className="small muted">{sub}</div>}</div>
);

function Overview({ s, health }: { s: Stats; health: Health | null }) {
  const { t } = useTranslation();
  const row = (label: string, ok: boolean, detail?: string) => (
    <div className="item" key={label}>
      <span className={`badge ${ok ? 'good' : 'warn'}`}>{ok ? t('admin.on') : t('admin.off')}</span>
      <div className="main"><div className="t">{label}</div>{detail && <div className="s">{detail}</div>}</div>
    </div>
  );
  return (
    <>
      <div className="grid2">
        {tile(t('owner.accounts'), s.accounts, t('owner.thisWeek', { n: s.accounts_week }))}
        {tile(t('owner.businesses'), s.businesses, t('owner.activeWeek', { n: s.businesses_active_week }))}
        {tile(t('owner.pro'), s.pro, t('owner.staff', { n: s.staff }))}
        {tile(t('owner.aiToday'), s.ai_today, t('owner.locked', { n: s.locked_accounts }))}
        {tile(t('owner.records'), s.records_week, formatMoney(s.money_recorded_week))}
        {tile(t('owner.payments'), s.payments_completed)}
      </div>
      {s.activity_14d && <Bars title={t('admin.activity')} days={s.activity_14d} value={(d) => d.active ?? 0} />}
      <Bars title={t('owner.signups')} days={s.signups_14d} value={(d) => d.n ?? 0} />
      {Object.keys(s.business_types).length > 0 && (
        <div className="list">
          {Object.entries(s.business_types).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
            <div key={type} className="item"><div className="main"><div className="t">{t(`orgTypes.${type}`, { defaultValue: type })}</div></div><div className="amt num">{n}</div></div>
          ))}
        </div>
      )}
      {health && (
        <>
          <div className="section-title"><span>{t('admin.health')}</span></div>
          <div className="list" data-testid="health">
            {row(t('admin.healthAi'), health.ai.length > 0, t('admin.healthAiN', { n: health.ai.length, names: health.ai.join(', ') || '—' }))}
            {row(t('admin.healthVoice'), health.voice)}
            {row(t('admin.healthVoiceBackup'), health.voice_backup)}
            {row(t('admin.healthPin'), health.pin_pepper)}
            {row(t('admin.healthPay'), health.payments)}
            {row(t('admin.healthPro'), health.pro_billing)}
          </div>
        </>
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
    </>
  );
}

/** A searchable list loaded 50 at a time from the admin function. */
function useList<T>(action: string, extra: Record<string, unknown>) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = JSON.stringify(extra);
  const fetchPage = (offset: number) => {
    setBusy(true);
    return call<{ total: number; rows: T[] }>(action, { ...extra, offset })
      .then((r) => { setTotal(r.total); setRows((cur) => (offset ? [...cur, ...r.rows] : r.rows)); setErr(''); })
      .catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the search or sort changes
  useEffect(() => { const h = setTimeout(() => fetchPage(0), 300); return () => clearTimeout(h); }, [action, key]);
  return { rows, total, busy, err, more: () => fetchPage(rows.length) };
}

function ListFooter({ shown, total, busy, more }: { shown: number; total: number | null; busy: boolean; more: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      {total !== null && <div className="small muted" style={{ textAlign: 'center' }}>{t('admin.showing', { n: shown, total })}</div>}
      {total !== null && shown < total && <button type="button" className="btn ghost block" disabled={busy} onClick={more}>{t('admin.more')}</button>}
    </>
  );
}

function Users({ onPick, onOrg }: { onPick: (phone: string) => void; onOrg: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const { rows, total, busy, err, more } = useList<UserRow>('users', { q });
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1 }} type="search" placeholder={t('admin.searchUsers')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('admin.searchUsers')} />
        <button type="button" className="btn" onClick={() => csv('accounts', rows.map((u) => ({ phone: u.phone ? `+${u.phone}` : '', name: u.name ?? '', joined: u.created_at, last_sign_in: u.last_sign_in_at ?? '', suspended: isOn(u.banned_until) ? 'yes' : '', businesses: u.businesses.map((b) => `${b.name} (${b.role})`).join('; ') })))} aria-label={t('admin.export')}><Icon name="download" size={18} /></button>
      </div>
      {err && <div className="alert bad small"><Icon name="alert" /><div>{err}</div></div>}
      <div className="list" data-testid="admin-users">
        {rows.map((u) => (
          <div key={u.id} className="item">
            <button type="button" className="main" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit' }} onClick={() => u.phone && onPick(u.phone)}>
              <div className="t with-badge"><span className="trunc">{u.name || (u.phone ? `+${u.phone}` : '—')}</span>{isOn(u.banned_until) && <span className="badge bad">{t('admin.suspended')}</span>}{u.verified && <span className="badge good">{t('phone.verifiedShort')}</span>}</div>
              <div className="s">{u.phone ? `+${u.phone} · ` : ''}{t('admin.joined', { date: day(u.created_at) })} · {t('admin.lastSeen', { date: day(u.last_sign_in_at, t('admin.never')) })}</div>
            </button>
            <div className="btn-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {u.businesses.slice(0, 2).map((b) => <button key={b.id} type="button" className="btn sm" onClick={() => onOrg(b.id)}>{b.name}</button>)}
            </div>
          </div>
        ))}
        {!rows.length && !busy && <div className="item"><div className="main small muted">{t('admin.none')}</div></div>}
      </div>
      <ListFooter shown={rows.length} total={total} busy={busy} more={more} />
    </>
  );
}

function Businesses({ onPick }: { onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'new' | 'active' | 'records' | 'name'>('active');
  const { rows, total, busy, err, more } = useList<OrgRow>('orgs', { q, sort });
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1 }} type="search" placeholder={t('admin.searchOrgs')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('admin.searchOrgs')} />
        <button type="button" className="btn" onClick={() => csv('businesses', rows.map((o) => ({ name: o.name, type: o.type, owner: o.owner_name, owner_phone: o.owner_phone ? `+${o.owner_phone}` : '', plan: isOn(o.plan_until) ? 'pro' : 'free', staff: o.staff, branches: o.branches, records: o.records, records_30d: o.records_30d, money_in_30d: o.money_in_30d / 100, last_record: o.last_record ? new Date(o.last_record).toISOString() : '', payments: o.payments ?? '', joined: new Date(o.created_at).toISOString() })))} aria-label={t('admin.export')}><Icon name="download" size={18} /></button>
      </div>
      <Seg value={sort} onChange={setSort} options={[['active', t('admin.sortActive')], ['new', t('admin.sortNew')], ['records', t('admin.sortRecords')], ['name', t('admin.sortName')]]} />
      {err && <div className="alert bad small"><Icon name="alert" /><div>{err}</div></div>}
      <div className="list" data-testid="admin-orgs">
        {rows.map((o) => (
          <button key={o.id} type="button" className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => onPick(o.id)}>
            <div className="main">
              <div className="t with-badge"><span className="trunc">{o.name}</span>
                {isOn(o.plan_until) && <span className="badge good">Pro</span>}
                {o.payments && <span className="badge">{t(o.payments === 'easy' ? 'admin.payEasy' : 'admin.payOwn')}</span>}</div>
              <div className="s">{t(`orgTypes.${o.type}`, { defaultValue: o.type })} · {o.owner_name || (o.owner_phone ? `+${o.owner_phone}` : '—')} · {t('admin.orgLine', { staff: o.staff, records: o.records })}</div>
              <div className="s">{t('admin.lastRecord', { date: day(o.last_record, t('admin.never')) })} · {t('admin.month', { n: o.records_30d, money: formatMoney(o.money_in_30d) })}</div>
            </div>
            <Icon name="chev" size={18} className="text-subtle" />
          </button>
        ))}
        {!rows.length && !busy && <div className="item"><div className="main small muted">{t('admin.none')}</div></div>}
      </div>
      <ListFooter shown={rows.length} total={total} busy={busy} more={more} />
    </>
  );
}

function OrgView({ id, onBack, onSupport }: { id: string; onBack: () => void; onSupport: (phone: string) => void }) {
  const { t } = useTranslation();
  const { toast, fail } = useOverlay();
  const [d, setD] = useState<OrgDetail | null>(null);
  const [err, setErr] = useState('');
  const load = () => call<OrgDetail>('org', { orgId: id }).then(setD).catch((e) => setErr(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);
  const pro = (months: number) => call('pro', { orgId: id, months }).then(() => { toast(t('admin.proDone')); load(); }).catch(fail);
  if (err) return <div className="stack"><button type="button" className="btn ghost" onClick={onBack}><Icon name="back" size={18} /> {t('common.back')}</button><Empty icon="alert" title={err} /></div>;
  if (!d) return <div className="muted small" role="status">{t('common.loading')}</div>;
  const o = d.org, isPro = o.plan === 'pro' && isOn(o.plan_until);
  return (
    <div className="stack" data-testid="admin-org">
      <button type="button" className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={onBack}><Icon name="back" size={18} /> {t('admin.businesses')}</button>
      <div className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>{o.name}</h2><span className={`badge ${isPro ? 'good' : ''}`}>{isPro ? t('admin.proUntil', { date: day(o.plan_until) }) : t('admin.free')}</span></div>
        <div className="small muted">{t(`orgTypes.${o.type}`, { defaultValue: o.type })} · {t('admin.joined', { date: day(o.created_at) })}{o.address ? ` · ${o.address}` : ''}</div>
        <div className="small">{o.owner_name || '—'}{o.owner_phone && <> · <button type="button" className="link" onClick={() => onSupport(o.owner_phone!)}>+{o.owner_phone}</button></>}</div>
        <div className="btn-row">
          {o.owner_phone && <a className="btn sm get" href={waLink(o.owner_phone, '')} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> WhatsApp</a>}
          <button type="button" className="btn sm" onClick={() => pro(1)}>{t('admin.give1')}</button>
          <button type="button" className="btn sm" onClick={() => pro(3)}>{t('admin.give3')}</button>
          {isPro && <button type="button" className="btn sm danger" onClick={() => confirm(t('common.confirm')) && pro(0)}>{t('admin.removePro')}</button>}
        </div>
      </div>
      <div className="grid2">
        {tile(t('admin.moneyIn30'), formatMoney(d.money_30d.in), t('admin.moneyOut30', { money: formatMoney(d.money_30d.out) }))}
        {tile(t('admin.creditOut'), formatMoney(d.credit_outstanding))}
        {tile(t('admin.recordsAll'), d.counts.records, t('admin.aiUses', { n: d.ai_14d }))}
        {tile(t('admin.people'), d.counts.customers, t('admin.suppliersN', { n: d.counts.suppliers }))}
        {tile(t('admin.productsN'), d.counts.products, t('admin.unpaidN', { n: d.counts.invoices_unpaid }))}
        {tile(t('admin.payments'), d.payments_mode ? t(d.payments_mode === 'easy' ? 'admin.payEasy' : 'admin.payOwn') : t('admin.off'), t('admin.groupsN', { n: d.counts.groups }))}
      </div>
      <Bars title={t('admin.recordsDaily')} days={d.activity_14d} value={(x) => x.records ?? 0} />
      <div className="section-title"><span>{t('admin.team')} ({d.members.length})</span></div>
      <div className="list">
        {d.members.map((m, i) => (
          <div key={i} className="item">
            <div className="main">
              <div className="t">{m.name} <span className="badge">{t(`roles.${m.role}`, { defaultValue: m.role })}</span>{!m.active && <span className="badge warn">{t('admin.inactive')}</span>}</div>
              <div className="s">{m.account ? `+${m.account}` : m.phone || '—'} · {t('admin.lastSeen', { date: day(m.last_sign_in_at, t('admin.never')) })}</div>
            </div>
          </div>
        ))}
      </div>
      {d.branches.length > 0 && <div className="small muted">{t('admin.branchesList', { names: d.branches.join(', ') })}</div>}
      {d.payments.length > 0 && (
        <>
          <div className="section-title"><span>{t('admin.recentPayments')}</span></div>
          <div className="list">
            {d.payments.map((p, i) => (
              <div key={i} className="item">
                <div className="main"><div className="t">{p.note || p.kind}</div><div className="s">{day(p.created_at)} · {t(`pay.status.${p.status}`, { defaultValue: p.status })}</div></div>
                <div className={`amt num ${p.kind === 'payout' ? '' : 'good'}`}>{p.kind === 'payout' ? '−' : '+'}{formatMoney(p.amount)}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-title"><span>{t('admin.recentActivity')}</span></div>
      {d.audit.length ? (
        <div className="list">
          {d.audit.map((a, i) => (
            <div key={i} className="item"><div className="main"><div className="t">{a.summary || `${a.action} ${a.entity}`}</div><div className="s">{new Date(a.at).toLocaleString()} · {a.member_name}</div></div></div>
          ))}
        </div>
      ) : <div className="card flat small muted">{t('admin.none')}</div>}
      <div className="small muted">{t('admin.viewLogged')}</div>
    </div>
  );
}

function MoneyTab({ onOrg }: { onOrg: (id: string) => void }) {
  const { t } = useTranslation();
  const [m, setM] = useState<Money | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call<Money>('money').then(setM).catch((e) => setErr(e.message)); }, []);
  if (err) return <Empty icon="alert" title={err} />;
  if (!m) return <div className="muted small" role="status">{t('common.loading')}</div>;
  return (
    <>
      <div className="grid2">
        {tile(t('admin.received30'), formatMoney(m.received_30d))}
        {tile(t('admin.sent30'), formatMoney(m.sent_30d))}
        {tile(t('admin.payOwn'), m.own_accounts)}
        {tile(t('admin.payEasy'), m.easy_accounts)}
      </div>
      <Bars title={t('admin.receivedDaily')} days={m.daily_14d} value={(d) => d.n ?? 0} money />
      {Object.keys(m.by_status).length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(m.by_status).map(([k, n]) => <span key={k} className={`badge ${k === 'completed' ? 'good' : k === 'failed' ? 'bad' : ''}`}>{t(`pay.status.${k}`, { defaultValue: k })}: {n}</span>)}
        </div>
      )}
      <div className="section-title"><span>{t('admin.latestPayments')}</span></div>
      {m.latest.length ? (
        <div className="list" data-testid="admin-money">
          {m.latest.map((p, i) => (
            <button key={i} type="button" className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => onOrg(p.org_id)}>
              <div className="main"><div className="t">{p.business}</div><div className="s">{p.note || p.kind} · {day(p.created_at)} · {t(`pay.status.${p.status}`, { defaultValue: p.status })}</div></div>
              <div className={`amt num ${p.kind === 'payout' ? '' : 'good'}`}>{p.kind === 'payout' ? '−' : '+'}{formatMoney(p.amount)}</div>
            </button>
          ))}
        </div>
      ) : <div className="card flat small muted">{t('admin.noPayments')}</div>}
    </>
  );
}

function AiTab({ onOrg }: { onOrg: (id: string) => void }) {
  const { t } = useTranslation();
  const [a, setA] = useState<Ai | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call<Ai>('ai').then(setA).catch((e) => setErr(e.message)); }, []);
  if (err) return <Empty icon="alert" title={err} />;
  if (!a) return <div className="muted small" role="status">{t('common.loading')}</div>;
  return (
    <>
      <Bars title={t('admin.aiDaily')} days={a.daily_14d} value={(d) => d.n ?? 0} />
      <div className="small muted">{t('admin.aiGuests', { n: a.guests_today })}</div>
      <div className="section-title"><span>{t('admin.aiTop')}</span></div>
      {a.top_week.length ? (
        <div className="list">
          {a.top_week.map((r) => (
            <button key={r.org_id} type="button" className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => onOrg(r.org_id)}>
              <div className="main"><div className="t">{r.name}</div></div><div className="amt num">{r.n}</div>
            </button>
          ))}
        </div>
      ) : <div className="card flat small muted">{t('admin.none')}</div>}
    </>
  );
}

function News() {
  const { t } = useTranslation();
  const { toast, fail } = useOverlay();
  const [list, setList] = useState<Note[]>([]);
  const [f, setF] = useState({ message: '', level: 'info', days: 7 });
  const [busy, setBusy] = useState(false);
  const load = () => call<{ announcements: Note[] }>('announcements').then((r) => {
    const now = Date.now();
    setList(r.announcements.map((n) => ({ ...n, live: n.active && (!n.expires_at || new Date(n.expires_at).getTime() > now) })));
  }).catch(fail);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  const live = (n: Note) => !!n.live;
  return (
    <>
      <form className="form" data-testid="admin-news" onSubmit={async (e) => {
        e.preventDefault();
        try { setBusy(true); await call('announce', f); toast(t('admin.announced')); setF({ ...f, message: '' }); load(); } catch (err) { fail(err); } finally { setBusy(false); }
      }}>
        <div className="small muted">{t('admin.newsHelp')}</div>
        <Field label={t('admin.message')}><textarea required maxLength={500} rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder={t('admin.messagePh')} /></Field>
        <div className="row" style={{ gap: 8 }}>
          <Field label={t('admin.kind')}><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="info">{t('admin.kindInfo')}</option><option value="warn">{t('admin.kindWarn')}</option></select></Field>
          <Field label={t('admin.days')}><input type="number" min={1} max={90} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) || 1 })} /></Field>
        </div>
        <button className="btn primary block" disabled={busy}><Icon name="send" size={18} /> {t('admin.announce')}</button>
      </form>
      <div className="section-title"><span>{t('admin.newsList')}</span></div>
      {list.length ? (
        <div className="list">
          {list.map((n) => (
            <div key={n.id} className="item" style={{ opacity: live(n) ? 1 : 0.55 }}>
              <div className="main">
                <div className="t" style={{ whiteSpace: 'pre-line' }}>{n.message}</div>
                <div className="s">{day(n.created_at)} · {live(n) ? t('admin.liveUntil', { date: day(n.expires_at) }) : t('admin.stopped')}</div>
              </div>
              {live(n) && <button type="button" className="btn sm" onClick={() => call('unannounce', { id: n.id }).then(load).catch(fail)}>{t('admin.stop')}</button>}
            </div>
          ))}
        </div>
      ) : <div className="card flat small muted">{t('admin.none')}</div>}
    </>
  );
}

function Support({ initialPhone = '', onOrg }: { initialPhone?: string; onOrg: (id: string) => void }) {
  const { t } = useTranslation();
  const { toast, fail } = useOverlay();
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [acct, setAcct] = useState<Account | null>(null);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(0); // when the account was looked up
  const [log, setLog] = useState<LogRow[]>([]);
  const loadLog = () => call<{ log: LogRow[] }>('log').then((r) => setLog(r.log)).catch(() => {});
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); loadLog(); } };
  const find = (p = phone) => run(async () => { setCode(''); setAcct(null); const a = (await call<{ account: Account }>('lookup', { phone: p })).account; setNow(Date.now()); setAcct(a); });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- opened from the Users list: look the account up straight away
  useEffect(() => { loadLog(); if (initialPhone) Promise.resolve().then(() => find(initialPhone)); }, []);
  const locked = acct?.locked_until && new Date(acct.locked_until).getTime() > now;
  const banned = isOn(acct?.banned_until);

  return (
    <>
      <form className="form" data-testid="support-find" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <Field label={t('admin.phone')}><input name="phone" type="tel" required inputMode="tel" placeholder="076 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <button className="btn primary block" disabled={busy}><Icon name="search" size={18} /> {t('admin.search')}</button>
      </form>
      {acct && (
        <div className="card stack" data-testid="support-account">
          <div className="row between"><b>{acct.name || `+${acct.phone}`}</b><span className="small muted">+{acct.phone}</span></div>
          <div className="small muted">{t('admin.joined', { date: day(acct.created_at) })} · {t('admin.lastSeen', { date: day(acct.last_sign_in_at, t('admin.never')) })}</div>
          <div className="small">
            {banned && <><span className="badge bad">{t('admin.suspended')}</span>{' '}</>}
            {locked ? <span className="badge bad">{t('admin.locked', { n: acct.wrong_pins ?? 0, time: new Date(acct.locked_until!).toLocaleTimeString() })}</span>
              : <span className="badge good">{t('admin.notLocked')}</span>}{' '}
            <span className="badge">{acct.has_recovery_code ? t('admin.hasCode') : t('admin.noCode')}</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await call('unlock', { phone: acct.phone }); toast(t('admin.unlocked')); await find(acct.phone); })}><Icon name="lock" size={18} /> {t('admin.unlock')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => confirm(t('admin.codeWarn')) && run(async () => { setCode((await call<{ code: string }>('recovery', { phone: acct.phone })).code); })}><Icon name="key" size={18} /> {t('admin.newCode')}</button>
            <button type="button" className={`btn ${banned ? '' : 'danger'}`} disabled={busy} onClick={() => confirm(t(banned ? 'admin.unsuspendWarn' : 'admin.suspendWarn')) && run(async () => { await call('suspend', { phone: acct.phone, on: !banned }); toast(t(banned ? 'admin.unsuspended' : 'admin.suspendedDone')); await find(acct.phone); })}>
              <Icon name={banned ? 'check' : 'stop'} size={18} /> {t(banned ? 'admin.unsuspend' : 'admin.suspend')}</button>
          </div>
          {code && (
            <div className="stack" data-testid="support-code">
              <div className="small muted">{t('admin.codeTitle')}</div>
              <div className="recovery-code num">{code}</div>
              <div className="small muted">{t('admin.codeWarn')}</div>
              <a className="btn get block" target="_blank" rel="noopener noreferrer" href={waLink(acct.phone, t('admin.codeMsg', { code }))}><Icon name="chat" size={18} /> {t('admin.sendCode')}</a>
            </div>
          )}
          <div className="section-title"><span>{t('admin.businesses')}</span></div>
          {acct.businesses.length ? acct.businesses.map((b) => {
            const pro = b.plan === 'pro' && (b.plan_until ?? 0) > now;
            return (
              <div key={b.id} className="card flat stack">
                <div className="row between"><b>{b.name}</b><span className={`badge ${pro ? 'good' : ''}`}>{pro ? t('admin.proUntil', { date: day(b.plan_until) }) : t('admin.free')}</span></div>
                <div className="small muted">{t(`roles.${b.role}`, { defaultValue: b.role })} · {t('admin.records', { n: b.records })}{b.last_record ? ` · ${t('admin.lastRecord', { date: day(b.last_record) })}` : ''}</div>
                <div className="btn-row">
                  <button type="button" className="btn sm" onClick={() => onOrg(b.id)}>{t('admin.open')}</button>
                  {[1, 3].map((m) => <button key={m} type="button" className="btn sm" disabled={busy} onClick={() => run(async () => { await call('pro', { orgId: b.id, months: m }); toast(t('admin.proDone')); await find(acct.phone); })}>{t(m === 1 ? 'admin.give1' : 'admin.give3')}</button>)}
                  {pro && <button type="button" className="btn sm danger" disabled={busy} onClick={() => confirm(t('common.confirm')) && run(async () => { await call('pro', { orgId: b.id, months: 0 }); toast(t('admin.proDone')); await find(acct.phone); })}>{t('admin.removePro')}</button>}
                </div>
              </div>
            );
          }) : <div className="small muted">—</div>}
        </div>
      )}
      <div className="section-title"><span>{t('admin.log')}</span></div>
      {log.length ? (
        <div className="list" data-testid="support-log">
          {log.map((l, i) => (
            <div key={i} className="item">
              <div className="main">
                <div className="t">{t(`admin.logActions.${l.action}`, { defaultValue: l.action })} · {l.target}</div>
                <div className="s">{new Date(l.at).toLocaleString()} · +{l.admin_phone}{l.detail ? ` · ${l.detail}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="card flat small muted">{t('admin.noLog')}</div>}
    </>
  );
}

function Inbox({ reports, reload, onError }: { reports: Report[]; reload: () => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const mark = (id: string, status: 'seen' | 'resolved') => call('report', { id, status }).then(reload).catch((e) => onError(e.message));
  return reports.length ? (
    <div className="list" data-testid="report-inbox">
      {reports.map((r) => (
        <div key={r.id} className="item report-item" style={{ opacity: r.status === 'resolved' ? 0.55 : 1 }}>
          <div className="main">
            <div className="t with-badge"><span className="trunc">{t(`report.kind.${r.kind}`, { defaultValue: r.kind })}{r.about && ` · ${r.about}`}</span>
              <span className={`badge ${r.status === 'resolved' ? 'good' : 'warn'}`}>{t(`owner.status.${r.status}`, { defaultValue: r.status })}</span></div>
            <div className="report-msg">{r.message}</div>
            <div className="s">{new Date(r.created_at).toLocaleString()}{r.app_info?.screen ? ` · ${r.app_info.screen}` : ''}{r.app_info?.automatic ? ` · ${t('owner.auto')}` : ''}</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              {/^\+?\d[\d\s]{6,}$/.test(r.contact) && <a className="btn sm get" href={waLink(r.contact, t('owner.replyMsg'))} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> {t('owner.reply')}</a>}
              {r.status === 'new' && <button className="btn sm" onClick={() => mark(r.id, 'seen')}>{t('admin.seen')}</button>}
              {r.status !== 'resolved' && <button className="btn sm tinted" onClick={() => mark(r.id, 'resolved')}><Icon name="check" size={16} /> {t('owner.resolve')}</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  ) : <div className="card flat small muted">{t('owner.noReports')}</div>;
}
