import { Suspense, useEffect, useState } from 'react';
import { lazyRetry } from '@/ui/lazy';
import { useTranslation } from 'react-i18next';
import { useApp, useBook, useLocalOrgs } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { LANGUAGES } from '@/i18n';
import { db, SYNC_TABLES } from '@/db/schema';
import { setMeta } from '@/db/repo';
import { updateOrg, setPin, hasPin, getSession, createOrg } from '@/domain/org';
import { exportOrg, importOrg, isEncrypted } from '@/domain/backup';
import { createDemo } from '@/domain/demo';
import { AI_DEFAULTS, getAiSettings, type AiSettings } from '@/ai/assistant';
import { getCloudConfig, setCloudConfig } from '@/cloud/supabase';
import { signOut, currentUser } from '@/cloud/auth';
import { syncNow } from '@/cloud/sync';
import { connectOrg } from '@/cloud/account';
import { ORG_TYPES } from './More';
import { Link } from 'react-router-dom';
import { ActionButton } from '@/ui/extras';
import { shareFile } from '@/lib/share';
import { isPro } from '@/domain/plan';
import { deleteCloudAccount } from '@/cloud/account-extra';

const CloudSignIn = lazyRetry(() => import('./CloudSignIn'));

function TaxCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  const o = book.org;
  const [f, setF] = useState({ tax_rate: o.tax_rate ?? 0, tax_inclusive: (o.tax_inclusive ?? 1) as 0 | 1, tax_id: o.tax_id ?? '', receipt_footer: o.receipt_footer ?? '' });
  return (
    <form className="form card" data-testid="tax-form" onSubmit={(e) => { e.preventDefault(); updateOrg(ctx, f).then(() => toast(t('common.saved'))).catch(fail); }}>
      <h3><Icon name="file" size={18} /> {t('tax.title')}</h3>
      <div className="small muted">{t('tax.help')}</div>
      <div className="grid2">
        <Field label={t('tax.rate')}><input name="tax_rate" inputMode="decimal" value={f.tax_rate} onChange={(e) => setF({ ...f, tax_rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
        <Field label={t('tax.tin')}><input value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} /></Field>
      </div>
      <Field label={t('tax.pricesAre')}>
        <select value={f.tax_inclusive} onChange={(e) => setF({ ...f, tax_inclusive: Number(e.target.value) as 0 | 1 })}>
          <option value={1}>{t('tax.inclusive')}</option><option value={0}>{t('tax.exclusive')}</option>
        </select>
      </Field>
      <Field label={t('tax.footer')}><input value={f.receipt_footer} placeholder={t('printer.thanks')} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} /></Field>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function PrinterCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { toast, fail } = useOverlay();
  const [p, setP] = useState<{ width: 58 | 80; mode: 'ble' | 'rawbt'; deviceId?: string; deviceName?: string } | null>(null);
  useEffect(() => { import('@/features/printer').then((m) => m.getPrinter()).then(setP); }, []);
  if (!p) return null;
  const save = async (next: typeof p) => { setP(next); (await import('@/features/printer')).savePrinter(next); };
  return (
    <div className="card stack">
      <h3><Icon name="print" size={18} /> {t('printer.title')}</h3>
      <div className="small muted">{t('printer.help')}</div>
      <div className="grid2">
        <Field label={t('printer.width')}>
          <select value={p.width} onChange={(e) => save({ ...p, width: Number(e.target.value) as 58 | 80 })}><option value={58}>58 mm</option><option value={80}>80 mm</option></select>
        </Field>
        <Field label={t('printer.connection')}>
          <select value={p.mode} onChange={(e) => save({ ...p, mode: e.target.value as 'ble' | 'rawbt' })}>
            <option value="ble">{t('printer.ble')}</option><option value="rawbt">{t('printer.rawbt')}</option>
          </select>
        </Field>
      </div>
      {p.mode === 'ble' && (
        <ActionButton icon="link" label={p.deviceName ? `${t('printer.paired')}: ${p.deviceName}` : t('printer.pair')} run={async () => {
          try { const d = await (await import('@/features/printer')).pairPrinter(); await save({ ...p, deviceId: d.id, deviceName: d.name }); toast(t('printer.pairedOk')); } catch (e) { fail(e); }
        }} />
      )}
      {p.mode === 'rawbt' && <div className="small muted">{t('printer.rawbtHelp')}</div>}
      <ActionButton icon="print" label={t('printer.test')} run={async () => {
        try {
          const m = await import('@/features/printer');
          await m.printBytes(m.receiptBytes(book, { txn: { items: [{ product_id: null, name: 'Test', qty: 1, price: 100, cost: 0 }], amount: 100, method: 'cash', date: new Date().toISOString().slice(0, 10), category: 'sale', note: '' } as never }, t, p.width));
          toast(t('printer.sent'));
        } catch (e) { fail(e); }
      }} />
    </div>
  );
}

function ExportCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { fail } = useOverlay();
  return (
    <div className="card stack">
      <h3><Icon name="download" size={18} /> {t('export.title')}</h3>
      <div className="small muted">{t('export.help')}</div>
      <ActionButton icon="download" label={t('export.excel')} testId="export-excel" run={async () => {
        try {
          const { businessWorkbook } = await import('@/features/excel');
          await shareFile(businessWorkbook(book, t), `kopor-${book.org.name.replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`, book.org.name);
        } catch (e) { fail(e); }
      }} />
    </div>
  );
}

export function Settings() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  return (
    <Page title={t('settings.title')} back="/more">
      <div className="list">
        <Link className="item" to="/account">
          <span className="tile" style={{ background: 'var(--tile-blue)' }}><Icon name="cloud" size={18} /></span>
          <div className="main"><div className="t">{t('settings.cloud')}</div><div className="s">{t('settings.signIn')} · {t('settings.signUp')} · {t('settings.syncNow')}</div></div>
          <Icon name="chev" size={18} className="text-subtle" />
        </Link>
      </div>
      {can('business') && <BusinessCard />}
      {can('business') && <TaxCard />}
      <PreferencesCard />
      <PrinterCard />
      <SecurityCard />
      <AiCard />
      {can('business') && <ExportCard />}
      {can('business') && <BackupCard />}
      <BusinessesCard />
      <div className="btn-row">
        <Link className="btn ghost sm" to="/help">{t('help.title')}</Link>
        <Link className="btn ghost sm" to="/legal/privacy">{t('legal.privacy')}</Link>
        <Link className="btn ghost sm" to="/legal/terms">{t('legal.terms')}</Link>
      </div>
      <div className="small muted" style={{ textAlign: 'center' }}>{t('settings.about')} · {isPro(book.org) ? 'PRO' : 'FREE'}</div>
    </Page>
  );
}

function BusinessCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { toast, fail } = useOverlay();
  const o = book.org;
  const [f, setF] = useState({ name: o.name, type: o.type, owner_name: o.owner_name, phone: o.phone, momo_number: o.momo_number, address: o.address, currency: o.currency, country_code: o.country_code });
  return (
    <form className="form card" onSubmit={(e) => { e.preventDefault(); updateOrg(ctx, f).then(() => toast(t('common.saved'))).catch(fail); }}>
      <h3><Icon name="store" size={18} /> {t('settings.business')}</h3>
      <Field label={t('onboard.bizName')}><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t('onboard.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{ORG_TYPES.map((k) => <option key={k} value={k}>{t(`orgTypes.${k}`)}</option>)}</select></Field>
        <Field label={t('onboard.owner')}><input value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></Field>
      </div>
      <div className="grid2">
        <Field label={t('common.phone')}><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={t('settings.momo')}><input value={f.momo_number} onChange={(e) => setF({ ...f, momo_number: e.target.value })} /></Field>
      </div>
      <Field label={t('settings.address')}><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t('settings.currency')}><input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
        <Field label={t('settings.cc')}><input inputMode="numeric" value={f.country_code} onChange={(e) => setF({ ...f, country_code: e.target.value.replace(/\D/g, '') })} /></Field>
      </div>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

function PreferencesCard() {
  const { t } = useTranslation();
  const { device, setDevice } = useApp();
  return (
    <div className="card stack">
      <h3><Icon name="globe" size={18} /> {t('settings.language')}</h3>
      <div className="lang-pick">{LANGUAGES.map((l) => <button key={l.code} className={device.lang === l.code ? 'on' : ''} aria-pressed={device.lang === l.code} onClick={() => setDevice({ lang: l.code })}>{l.label}</button>)}</div>
      <Field label={t('settings.theme')}>
        <select value={device.theme} onChange={(e) => setDevice({ theme: e.target.value as 'auto' })}>
          {(['auto', 'light', 'dark'] as const).map((k) => <option key={k} value={k}>{t(`settings.${k}`)}</option>)}
        </select>
      </Field>
    </div>
  );
}

function SecurityCard() {
  const { t } = useTranslation();
  const { member, device, setDevice } = useApp();
  const { toast, fail } = useOverlay();
  const [on, setOn] = useState(false);
  const [pin, setPinText] = useState('');
  useEffect(() => { if (member) hasPin(member.id).then(setOn); }, [member]);
  if (!member) return null;
  return (
    <form className="form card" data-testid="pin-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await setPin(member.id, pin); setOn(true); setPinText(''); toast(t('team.pinSet')); } catch (err) { fail(err); }
    }}>
      <h3><Icon name="lock" size={18} /> {t('settings.security')}</h3>
      <div className="small muted">{on ? t('settings.pinOn') : t('settings.pinOff')}</div>
      <Field label={t('settings.newPin')}><input type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} required value={pin} onChange={(e) => setPinText(e.target.value.replace(/\D/g, ''))} autoComplete="new-password" /></Field>
      <div className="btn-row">
        <button className="btn primary">{on ? t('settings.changePin') : t('common.save')}</button>
        {on && <button type="button" className="btn ghost" onClick={() => setPin(member.id, null).then(() => setOn(false))}>{t('settings.removePin')}</button>}
      </div>
      <Field label={t('settings.autoLock')}>
        <select value={device.autoLockMin} onChange={(e) => setDevice({ autoLockMin: Number(e.target.value) })}>{[1, 2, 5, 10, 30, 0].map((m) => <option key={m} value={m}>{m || '∞'}</option>)}</select>
      </Field>
    </form>
  );
}

function AiCard() {
  const { t } = useTranslation();
  const { toast } = useOverlay();
  const [f, setF] = useState<AiSettings>(AI_DEFAULTS);
  useEffect(() => { getAiSettings().then((s) => setF({ ...AI_DEFAULTS, ...s })); }, []);
  return (
    <form className="form card" onSubmit={(e) => { e.preventDefault(); setMeta('ai', f).then(() => toast(t('common.saved'))); }}>
      <h3><Icon name="spark" size={18} /> {t('settings.ai')}</h3>
      <div className="small muted">{t('settings.aiHelp')}</div>
      <Field label={t('settings.aiKey')}><input type="password" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.trim() })} autoComplete="off" placeholder="gsk_…" /></Field>
      <Field label={t('settings.aiBase')}><input value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} /></Field>
      <div className="grid2">
        <Field label={t('settings.aiModel')}><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
        <Field label={t('settings.aiVision')}><input value={f.visionModel} onChange={(e) => setF({ ...f, visionModel: e.target.value })} /></Field>
      </div>
      <button className="btn primary block">{t('common.save')}</button>
    </form>
  );
}

/** Cloud & account screen (More → Cloud & account). */
export function Account() {
  const { t } = useTranslation();
  return <Page title={t('settings.cloud')} back="/more"><CloudCard /></Page>;
}

export function CloudCard() {
  const { t } = useTranslation();
  const { ctx, sync, can } = useApp();
  const { openSheet, fail, toast } = useOverlay();
  const [cfg, setCfg] = useState<boolean | null>(null);
  const [user, setUser] = useState<{ email?: string; user_metadata?: { phone?: string } } | null>(null);
  const refresh = () => { getCloudConfig().then((c) => setCfg(!!c)); currentUser().then(setUser); };
  useEffect(refresh, [sync.status]);
  return (
    <div className="card stack">
      <h3><Icon name="cloud" size={18} /> {t('settings.cloud')}</h3>
      <div className="small muted">{t('settings.cloudHelp')}</div>
      {user ? (
        <>
          <div className="row between small"><span>{t('settings.signedInAs', { phone: user.user_metadata?.phone ?? user.email })}</span></div>
          <div className="small"><i className={`sync-dot ${sync.status}`} />{sync.status === 'syncing' ? t('settings.syncing') : sync.status === 'error' ? t('settings.syncError', { error: sync.error }) : sync.lastSync ? t('settings.lastSync', { time: new Date(sync.lastSync).toLocaleTimeString() }) : t('settings.syncOff')}</div>
          <div className="btn-row">
            <button className="btn" onClick={() => syncNow(ctx.orgId)}><Icon name="cloud" size={18} /> {t('settings.syncNow')}</button>
            <button className="btn ghost" onClick={() => signOut().then(refresh)}>{t('settings.signOut')}</button>
          </div>
          {can('business') && <button className="btn block" onClick={() => connectOrg(ctx.orgId, ctx.memberId!).then(() => toast(t('common.done'))).catch(fail)}><Icon name="upload" size={18} /> {t('settings.upload')}</button>}
          <button className="btn danger block" onClick={async () => {
            if (!confirm(t('account.confirm'))) return;
            try { await deleteCloudAccount(); refresh(); toast(t('account.deleted')); } catch (e) { fail(e); }
          }}><Icon name="trash" size={18} /> {t('account.delete')}</button>
        </>
      ) : cfg !== null && (
        <button className="btn primary block" onClick={() => openSheet(t('settings.cloud'), <Suspense fallback={t('common.loading')}><CloudSignIn onDone={refresh} /></Suspense>)}>{t('settings.signIn')} / {t('settings.signUp')}</button>
      )}
      {cfg && !import.meta.env.VITE_SUPABASE_URL && <button className="btn ghost sm" onClick={() => setCloudConfig(null).then(refresh)}>{t('common.edit')} Supabase</button>}
    </div>
  );
}

function BackupCard() {
  const { t } = useTranslation();
  const { ctx, switchSession } = useApp();
  const { toast, fail } = useOverlay();
  const [pw, setPw] = useState('');
  const download = async () => {
    const text = await exportOrg(ctx.orgId, pw || undefined);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `kopor-backup-${new Date().toISOString().slice(0, 10)}${pw ? '-encrypted' : ''}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const pass = isEncrypted(text) ? prompt(t('settings.backupPassword')) ?? '' : undefined;
      await importOrg(text, pass);
      await switchSession(await getSession());
      toast(t('settings.restored'));
    } catch (e) { fail(e); }
  };
  return (
    <div className="card stack">
      <h3><Icon name="download" size={18} /> {t('settings.backup')}</h3>
      <div className="small muted">{t('settings.backupHelp')}</div>
      <Field label={t('settings.backupPassword')}><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
      <div className="btn-row">
        <button className="btn" onClick={download}><Icon name="download" size={18} /> {t('settings.download')}</button>
        <label className="btn"><Icon name="upload" size={18} /> {t('settings.restore')}<input type="file" accept=".json,application/json" hidden onChange={(e) => restore(e.target.files?.[0])} /></label>
      </div>
    </div>
  );
}

function BusinessesCard() {
  const { t } = useTranslation();
  const { ctx, switchSession, can, member } = useApp();
  const { fail } = useOverlay();
  const orgs = useLocalOrgs();
  const open = async (orgId: string) => {
    const m = (await db.members.where('org_id').equals(orgId).toArray()).find((x) => x.active && !x.deleted && (x.user_id === member?.user_id || x.role === 'owner'));
    if (m) await switchSession({ orgId, memberId: m.id, branchId: m.branch_id });
  };
  const wipe = async () => {
    if (!confirm(t('settings.resetConfirm'))) return;
    await db.transaction('rw', db.tables, async () => {
      for (const tb of SYNC_TABLES) await db.t(tb).where(tb === 'orgs' ? 'id' : 'org_id').equals(ctx.orgId).delete();
    });
    const other = orgs.find((o) => o.id !== ctx.orgId);
    if (other) await open(other.id); else await switchSession(null);
  };
  return (
    <div className="card stack">
      <h3><Icon name="store" size={18} /> {t('settings.businesses')}</h3>
      {orgs.map((o) => (
        <button key={o.id} className={`btn block ${o.id === ctx.orgId ? 'primary' : ''}`} onClick={() => open(o.id).catch(fail)}>{o.name}</button>
      ))}
      <div className="btn-row">
        <button className="btn ghost" onClick={async () => {
          const name = prompt(t('onboard.bizName'));
          if (name) { await createOrg({ name, type: 'shop', owner: member?.name ?? '', phone: member?.phone ?? '' }); await switchSession(await getSession()); }
        }}><Icon name="plus" size={18} /> {t('settings.addBusiness')}</button>
        <button className="btn ghost" onClick={async () => { await createDemo(); await switchSession(await getSession()); }}>{t('settings.demo')}</button>
      </div>
      {can('business') && <button className="btn danger block" onClick={() => wipe().catch(fail)}><Icon name="trash" size={18} /> {t('settings.reset')}</button>}
    </div>
  );
}
