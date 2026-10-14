import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useErrorText } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { initials } from '@/ui/widgets';
import { checkPin, hasPin } from '@/domain/org';

/** Lock screen with member picker (shared shop phone) and PIN pad. */
export function Lock() {
  const { t } = useTranslation();
  const { session, switchSession, unlock } = useApp();
  const book = useBook();
  const errText = useErrorText();
  const members = book.members.filter((m) => m.active);
  const [memberId, setMemberId] = useState(session!.memberId);
  const [pin, setPinText] = useState('');
  const [msg, setMsg] = useState('');
  const [withPin, setWithPin] = useState<Set<string>>(new Set());

  useEffect(() => {
    const active = book.members.filter((m) => m.active);
    Promise.all(active.map(async (m) => [m.id, await hasPin(m.id)] as const)).then((r) => setWithPin(new Set(r.filter((x) => x[1]).map((x) => x[0]))));
  }, [book.members]);

  const tryPin = async (p: string) => {
    try {
      if (await checkPin(memberId, p)) {
        const m = members.find((x) => x.id === memberId)!;
        await switchSession({ orgId: session!.orgId, memberId, branchId: m.branch_id });
        unlock();
      } else { setMsg(t('lock.wrong')); setPinText(''); }
    } catch (e) { setMsg(errText(e)); setPinText(''); }
  };
  // PINs can be 4-8 digits, so verification happens on OK rather than after a fixed length.
  const press = (d: string) => { setMsg(''); setPinText((pin + d).slice(0, 8)); };
  const choosable = members.filter((m) => withPin.has(m.id));

  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content" style={{ paddingTop: 40, alignItems: 'center', textAlign: 'center' }}>
        <div className="boot-logo"><Icon name="lock" size={32} /></div>
        <h1 style={{ fontSize: 22 }}>{book.org.name}</h1>
        {choosable.length > 1 && (
          <>
            <div className="muted">{t('lock.title')}</div>
            <div className="member-pick">
              {choosable.map((m) => (
                <button key={m.id} type="button" className={m.id === memberId ? 'on' : ''} onClick={() => { setMemberId(m.id); setPinText(''); }}>
                  <span className="avatar">{initials(m.name)}</span>{m.name.split(' ')[0]}<small className="muted">{t(`roles.${m.role}`)}</small>
                </button>
              ))}
            </div>
          </>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (pin.length >= 4) tryPin(pin); }} className="stack" style={{ alignItems: 'center' }}>
          <label className="sr-only" htmlFor="pin">{t('lock.pin')}</label>
          <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={8} value={pin}
            onChange={(e) => { setMsg(''); setPinText(e.target.value.replace(/\D/g, '')); }} className="amount-input" style={{ width: 200 }} placeholder={t('lock.pin')} autoFocus />
          <div className="pin-dots" aria-hidden="true">{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
          <div className="pinpad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button type="button" key={d} onClick={() => press(d)}>{d}</button>)}
            <button type="button" onClick={() => setPinText(pin.slice(0, -1))} aria-label={t('common.back')}>⌫</button>
            <button type="button" onClick={() => press('0')}>0</button>
            <button type="submit" aria-label={t('lock.unlock')} style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}><Icon name="check" /></button>
          </div>
          <div className="bad small" role="alert" style={{ minHeight: 20 }}>{msg}</div>
        </form>
        <div className="small muted">{t('lock.forgot')}</div>
      </div>
    </div>
  );
}
