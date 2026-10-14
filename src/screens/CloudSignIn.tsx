// Phone + PIN sign-in/sign-up, used from Welcome and Settings. Loaded on demand.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { getSession } from '@/domain/org';
import { getCloudConfig, setCloudConfig } from '@/cloud/supabase';
import { signIn, signUp } from '@/cloud/auth';
import { remoteOrgs } from '@/cloud/sync';
import { openCloudOrg } from '@/cloud/account';

export default function CloudSignIn({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const { switchSession } = useApp();
  const { closeSheet, fail, toast } = useOverlay();
  const [cfg, setCfg] = useState({ url: '', anonKey: '' });
  const [hasCfg, setHasCfg] = useState<boolean | null>(null);
  const [f, setF] = useState({ phone: '', pin: '', name: '' });
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [orgs, setOrgs] = useState<{ id: string; name: string; role: string }[] | null>(null);
  useEffect(() => { getCloudConfig().then((c) => setHasCfg(!!c)); }, []);

  if (hasCfg === false) return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); setCloudConfig(cfg).then(() => setHasCfg(true)).catch(fail); }}>
      <div className="small muted">{t('settings.cloudHelp')}</div>
      <Field label={t('settings.cloudUrl')}><input required placeholder="https://xxxx.supabase.co" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} /></Field>
      <Field label={t('settings.cloudKey')}><input required value={cfg.anonKey} onChange={(e) => setCfg({ ...cfg, anonKey: e.target.value })} /></Field>
      <button className="btn primary block">{t('settings.cloudSave')}</button>
    </form>
  );
  if (orgs) return (
    <div className="stack">
      {orgs.length ? orgs.map((o) => (
        <button key={o.id} className="btn block" onClick={async () => {
          try { await openCloudOrg(o.id); await switchSession(await getSession()); closeSheet(); onDone?.(); } catch (e) { fail(e); }
        }}><Icon name="store" size={18} /> {o.name} · {t(`roles.${o.role}`)}</button>
      )) : <div className="muted">{t('settings.noCloudOrgs')}</div>}
    </div>
  );
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        if (mode === 'up') await signUp(f.phone, f.pin, f.name); else await signIn(f.phone, f.pin);
        toast(t('common.done'));
        setOrgs(await remoteOrgs());
      } catch (err) { fail(err); }
    }}>
      <div className="seg">
        <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>{t('settings.signIn')}</button>
        <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>{t('settings.signUp')}</button>
      </div>
      {mode === 'up' && <Field label={t('common.name')}><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
      <Field label={t('common.phone')}><input type="tel" required autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t('settings.cloudPin')}><input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
      <button className="btn primary block">{mode === 'up' ? t('settings.signUp') : t('settings.signIn')}</button>
    </form>
  );
}
