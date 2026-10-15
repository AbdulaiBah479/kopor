import { Suspense, useState } from 'react';
import { lazyRetry } from '@/ui/lazy';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { LANGUAGES } from '@/i18n';
import { createOrg, setPin, getSession } from '@/domain/org';
import { createDemo } from '@/domain/demo';
import { ORG_TYPES } from './More';

const CloudSignIn = lazyRetry(() => import('./CloudSignIn'));

export function Welcome() {
  const { t } = useTranslation();
  const { device, setDevice, switchSession } = useApp();
  const { fail, openSheet } = useOverlay();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', type: 'shop', owner: '', phone: '', pin: '' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { owner } = await createOrg({ name: f.name, type: f.type, owner: f.owner, phone: f.phone });
      if (f.pin) await setPin(owner.id, f.pin);
      await switchSession(await getSession());
    } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const demo = async () => {
    setBusy(true);
    try { await createDemo(); await switchSession(await getSession()); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const features: [string, string][] = [['book', 'f1'], ['cash', 'f2'], ['box', 'f3'], ['users', 'f4'], ['file', 'f5'], ['spark', 'f6'], ['store', 'f7'], ['bank', 'f8']];
  return (
    <main className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 28 }}>
        <div className="row">
          <div className="boot-logo" style={{ width: 56, height: 56, fontSize: 30 }}>K</div>
          <div><h1 style={{ fontSize: 26 }}>{t('welcome.title')}</h1><div className="muted">{t('app.tagline')}</div></div>
        </div>

        <div className="stack">
          <b className="small">{t('welcome.language')}</b>
          <div className="lang-pick">
            {LANGUAGES.map((l) => (
              <button key={l.code} type="button" className={device.lang === l.code ? 'on' : ''} aria-pressed={device.lang === l.code} onClick={() => setDevice({ lang: l.code })}>{l.label}</button>
            ))}
          </div>
        </div>

        <div className="card feature-list">
          {features.map(([ic, k]) => <div key={k}><Icon name={ic} size={18} /><span>{t(`welcome.${k}`)}</span></div>)}
        </div>

        <form className="form card" onSubmit={submit}>
          <h2>{t('welcome.create')}</h2>
          <Field label={t('onboard.bizName')}><input required value={f.name} placeholder={t('onboard.bizNamePh')} onChange={(e) => setF({ ...f, name: e.target.value })} name="business" /></Field>
          <Field label={t('onboard.type')}>
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{ORG_TYPES.map((k) => <option key={k} value={k}>{t(`orgTypes.${k}`)}</option>)}</select>
          </Field>
          <div className="grid2">
            <Field label={t('onboard.owner')}><input value={f.owner} placeholder={t('onboard.ownerPh')} onChange={(e) => setF({ ...f, owner: e.target.value })} name="owner" /></Field>
            <Field label={t('onboard.phone')}><input type="tel" inputMode="tel" value={f.phone} placeholder="076 123 456" onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Field label={t('onboard.pin')} hint={t('onboard.pinHelp')}>
            <input type="password" inputMode="numeric" pattern="\d{4,8}" maxLength={8} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} autoComplete="new-password" />
          </Field>
          <button className="btn primary block" disabled={busy}>{t('common.start')}</button>
        </form>

        <div className="btn-row">
          <button className="btn ghost" disabled={busy} onClick={() => openSheet(t('welcome.signIn'), <Suspense fallback={t('common.loading')}><CloudSignIn /></Suspense>)}><Icon name="cloud" size={18} /> {t('welcome.signIn')}</button>
          <button className="btn ghost" disabled={busy} onClick={demo} data-testid="demo">{busy ? t('common.loading') : t('welcome.demo')}</button>
        </div>
        <div className="small muted" style={{ textAlign: 'center' }}>{t('welcome.free')}</div>
      </div>
    </main>
  );
}
