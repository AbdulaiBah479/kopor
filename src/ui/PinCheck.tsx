// "Enter your PIN again" before sensitive actions (exporting data, changing staff, approving, deleting the
// business), as banking apps do. Someone who picks up an unlocked phone still cannot do these. With no PIN set on
// this phone it lets the action through (and Settings suggests setting one).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from './overlay';
import { Field } from './widgets';
import { Icon } from './Icon';
import { checkPin, hasPin } from '@/domain/org';
import { protectScreen } from '@/features/privacy';

function PinAsk({ memberId, done }: { memberId: string; done: (ok: boolean) => void }) {
  const { t } = useTranslation();
  const { fail } = useOverlay();
  const [pin, setPin] = useState('');
  // Closed without an answer (swiped away, back button): the same as Cancel.
  const answered = useRef(false);
  const answer = (ok: boolean) => { answered.current = true; done(ok); };
  useEffect(() => () => { if (!answered.current) done(false); }, [done]);
  return (
    <form className="form" data-testid="pin-check" onSubmit={async (e) => {
      e.preventDefault();
      try { if (await checkPin(memberId, pin)) answer(true); else { setPin(''); fail(new Error(t('err.login'))); } } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('safe.pinAgain')}</div>
      <Field label={t('safe.pin')}><input type="password" inputMode="numeric" autoComplete="off" autoFocus required name="pin_check" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
      <div className="btn-row">
        <button className="btn primary"><Icon name="lock" size={18} /> {t('safe.confirm')}</button>
        <button type="button" className="btn ghost" onClick={() => answer(false)}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

/** Returns askPin(): resolves true when the PIN was right (or no PIN is set on this phone). */
export function usePinCheck() {
  const { t } = useTranslation();
  const { member } = useApp();
  const { openSheet, closeSheet } = useOverlay();
  return useCallback(async (): Promise<boolean> => {
    if (!member || !(await hasPin(member.id))) return true;
    const release = protectScreen();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (settled) return; settled = true; release(); closeSheet(); resolve(ok); };
      openSheet(t('safe.title'), <PinAsk memberId={member.id} done={done} />);
    });
  }, [member, openSheet, closeSheet, t]);
}
