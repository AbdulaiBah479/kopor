// "Verify your number": a 6-digit code by text message proves the account's phone is really yours.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field } from '@/ui/widgets';
import { checkPhoneCode, phoneStatus, sendPhoneCode } from '@/cloud/phoneCheck';

export function PhoneCheckRow() {
  const { t } = useTranslation();
  const { openSheet } = useOverlay();
  const [s, setS] = useState<{ available: boolean; verified: boolean } | null>(null);
  useEffect(() => { phoneStatus().then(setS).catch(() => setS(null)); }, []);
  if (!s?.available && !s?.verified) return null;
  return s.verified
    ? <div className="small good" data-testid="phone-verified"><Icon name="check" size={16} /> {t('phone.verified')}</div>
    : <button type="button" className="btn tinted block" data-testid="verify-phone" onClick={() => openSheet(t('phone.title'), <PhoneCheckSheet onDone={() => setS({ ...s, verified: true })} />)}><Icon name="shield" size={18} /> {t('phone.verify')}</button>;
}

function PhoneCheckSheet({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { closeSheet, toast, fail } = useOverlay();
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); } };
  return (
    <div className="stack" data-testid="phone-check">
      <div className="small muted">{t('phone.help')}</div>
      <button type="button" className="btn block" disabled={busy} onClick={() => run(async () => { const r = await sendPhoneCode(); if (r.verified) { onDone(); closeSheet(); return; } setSentTo(r.to ?? ''); })}>
        <Icon name="sms" size={18} /> {sentTo ? t('phone.again') : t('phone.send')}</button>
      {sentTo && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await checkPhoneCode(code); toast(t('phone.done')); onDone(); closeSheet(); }); }}>
          <div className="small">{t('phone.sent', { to: sentTo })}</div>
          <Field label={t('phone.code')}><input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
          <button className="btn primary block" disabled={busy || code.length !== 6}>{t('phone.confirm')}</button>
        </form>
      )}
      <div className="small muted">{t('phone.never')}</div>
    </div>
  );
}
