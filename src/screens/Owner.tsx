// Owner dashboard (back office) for whoever runs Kopor: how the service is used, whether it is healthy, the reports
// inbox, and support tools (find an account, unlock it, give a recovery code, give Pro to testers).
// Only phone numbers listed in the KOPOR_ADMIN_PHONES server secret can open it (checked by the admin function).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, Seg } from '@/ui/widgets';
import { useOverlay } from '@/ui/overlay';
import { formatMoney } from '@/lib/money';
import { waLink } from '@/lib/phone';
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
  has_recovery_code: boolean; businesses: Biz[];
}
interface LogRow { at: string; admin_phone: string; action: string; target: string; detail: string }

const LINKS: [string, string, string][] = [
  ['owner.linkUsers', 'users', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/auth/users'],
  ['owner.linkData', 'list', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/editor'],
  ['owner.linkLogs', 'pulse', 'https://supabase.com/dashboard/project/hpmpbzcloklaeghekjfz/functions'],
  ['owner.linkDeploys', 'upload', 'https://github.com/AbdulaiBah479/kopor/actions'],
  ['owner.linkAi', 'spark', 'https://console.groq.com/dashboard/usage'],
];

type Tab = 'overview' | 'support' | 'reports';

export function Owner() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const [s, setS] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState('');
  const [at, setAt] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const loadReports = () => call<{ reports: Report[] }>('reports').then((r) => setReports(r.reports)).catch(() => {});
  const load = () => call<{ stats: Stats; health: Health; at: string }>('stats')
    .then((r) => { setS(r.stats); setHealth(r.health); setAt(r.at); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); loadReports(); }, []);
  const waiting = s?.reports_waiting ?? 0;

  return (
    <Page title={t('owner.title')} sub={t('owner.sub')} back="/more"
      right={<button className="icon-btn" onClick={() => { load(); loadReports(); }} aria-label={t('ux.refreshing')}><Icon name="refresh" size={20} /></button>}>
      {err && <Empty icon="lock" title={err} />}
      {s && (
        <>
          <Seg<Tab> value={tab} onChange={setTab} options={[['overview', t('admin.overview')], ['support', t('admin.support')], ['reports', waiting ? `${t('admin.reports')} (${waiting})` : t('admin.reports')]]} />
          {tab === 'overview' && <Overview s={s} health={health} />}
          {tab === 'support' && <Support />}
          {tab === 'reports' && <Inbox reports={reports} reload={() => { loadReports(); load(); }} onError={setErr} />}
          <div className="small muted" style={{ textAlign: 'center' }}>{t('owner.updated', { time: new Date(at).toLocaleString() })}</div>
        </>
      )}
    </Page>
  );
}

function Bars({ title, days, value }: { title: string; days: Day[]; value: (d: Day) => number }) {
  const { i18n } = useTranslation();
  const max = Math.max(1, ...days.map(value));
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="owner-bars" role="img" aria-label={`${title}: ${days.map((d) => value(d)).join(', ')}`}>
        {days.map((d) => (
          <div key={d.day} className="owner-bar" title={`${d.day}: ${value(d)}`}>
            <span style={{ height: `${(value(d) / max) * 100}%` }} />
            <small>{new Date(d.day).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric' })}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Overview({ s, health }: { s: Stats; health: Health | null }) {
  const { t } = useTranslation();
  const tile = (label: string, value: string | number, sub?: string) => (
    <div className="stat"><div className="k">{label}</div><div className="v num">{value}</div>{sub && <div className="small muted">{sub}</div>}</div>
  );
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

function Support() {
  const { t } = useTranslation();
  const { toast, fail } = useOverlay();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [acct, setAcct] = useState<Account | null>(null);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(0); // when the account was looked up
  const [log, setLog] = useState<LogRow[]>([]);
  const loadLog = () => call<{ log: LogRow[] }>('log').then((r) => setLog(r.log)).catch(() => {});
  useEffect(() => { loadLog(); }, []);
  const day = (v: string | number | null) => (v ? new Date(v).toLocaleDateString() : t('admin.never'));
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); loadLog(); } };
  const find = (p = phone) => run(async () => { setCode(''); setAcct(null); const a = (await call<{ account: Account }>('lookup', { phone: p })).account; setNow(Date.now()); setAcct(a); });
  const locked = acct?.locked_until && new Date(acct.locked_until).getTime() > now;

  return (
    <>
      <form className="form" data-testid="support-find" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <Field label={t('admin.phone')}><input name="phone" type="tel" required inputMode="tel" placeholder="076 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <button className="btn primary block" disabled={busy}><Icon name="search" size={18} /> {t('admin.search')}</button>
      </form>
      {acct && (
        <div className="card stack" data-testid="support-account">
          <div className="row between"><b>{acct.name || `+${acct.phone}`}</b><span className="small muted">+{acct.phone}</span></div>
          <div className="small muted">{t('admin.joined', { date: day(acct.created_at) })} · {t('admin.lastSeen', { date: day(acct.last_sign_in_at) })}</div>
          <div className="small">
            {locked ? <span className="badge bad">{t('admin.locked', { n: acct.wrong_pins ?? 0, time: new Date(acct.locked_until!).toLocaleTimeString() })}</span>
              : <span className="badge good">{t('admin.notLocked')}</span>}{' '}
            <span className="badge">{acct.has_recovery_code ? t('admin.hasCode') : t('admin.noCode')}</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await call('unlock', { phone: acct.phone }); toast(t('admin.unlocked')); await find(acct.phone); })}><Icon name="lock" size={18} /> {t('admin.unlock')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => confirm(t('admin.codeWarn')) && run(async () => { setCode((await call<{ code: string }>('recovery', { phone: acct.phone })).code); })}><Icon name="key" size={18} /> {t('admin.newCode')}</button>
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
