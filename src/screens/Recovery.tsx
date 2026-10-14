// Recovery code display (after sign-up or on request) and the "Forgot your PIN?" reset form.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { resetPin } from '@/cloud/recovery';

export function RecoveryCodeCard({ code, onDone }: { code: string; onDone?: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" data-testid="recovery-code">
      <h3><Icon name="key" size={18} /> {t('recover.codeTitle')}</h3>
      <div className="recovery-code num" aria-label={t('recover.code')}>{code}</div>
      <div className="small muted">{t('recover.codeHelp')}</div>
      <div className="btn-row">
        <a className="btn get" href={`https://wa.me/?text=${encodeURIComponent(t('recover.msg', { code }))}`} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={18} /> {t('recover.saveWa')}</a>
        <button type="button" className="btn tinted" onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {})}>
          <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      {onDone && <button type="button" className="btn primary block" onClick={onDone}>{t('recover.done')}</button>}
    </div>
  );
}

export function ResetPinForm({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useTranslation();
  const { fail, toast } = useOverlay();
  const [f, setF] = useState({ phone: '', code: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState('');
  if (fresh) return <RecoveryCodeCard code={fresh} onDone={onSignedIn} />;
  return (
    <form className="form" data-testid="reset-pin" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { setFresh(await resetPin(f.phone, f.code, f.pin)); toast(t('recover.resetDone')); } catch (err) { fail(err); } finally { setBusy(false); }
    }}>
      <Field label={t('common.phone')}><input name="phone" type="tel" required autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t('recover.code')}><input name="code" required autoComplete="one-time-code" autoCapitalize="characters" placeholder="XXXXX-XXXXX" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
      <Field label={t('recover.newPin')}><input name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="new-password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
      <button className="btn primary block" disabled={busy}>{t('recover.reset')}</button>
      <div className="small muted">{t('recover.noCode')}</div>
    </form>
  );
}
