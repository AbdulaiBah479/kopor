// "Wait for Paid": after sending a payment link or code, the cashier keeps this on screen and hands over the goods
// only when it turns green. It turns green only after Monime's own message arrived and Kopor's server double-checked
// it, so "I have sent it" or a fake SMS screenshot never works.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { formatMoney } from '@/lib/money';
import { paymentStatus } from '@/cloud/payments';
import { syncNow } from '@/cloud/sync';

type State = 'waiting' | 'paid' | 'failed' | 'stopped';
const EVERY = 3_000, GIVE_UP = 15 * 60_000;

export function WaitForPaid({ orgId, requestId, amount }: { orgId: string; requestId: string; amount: number }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>('waiting');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true, timer = 0;
    const started = Date.now();
    const check = async () => {
      try {
        const r = await paymentStatus(orgId, requestId);
        if (!live) return;
        if (r.status === 'completed') {
          setState('paid');
          navigator.vibrate?.([120, 60, 120]);
          void syncNow(orgId).catch(() => {}); // bring the recorded sale or paid invoice onto this phone
          return;
        }
        if (['failed', 'expired', 'cancelled', 'reversed'].includes(r.status)) { setState('failed'); return; }
      } catch { /* a dropped connection: keep trying */ }
      if (Date.now() - started > GIVE_UP) { setState('stopped'); return; }
      timer = window.setTimeout(check, EVERY);
    };
    void check();
    return () => { live = false; window.clearTimeout(timer); };
  }, [orgId, requestId, tick]);

  return (
    <div className={`paid-box ${state}`} data-testid="wait-paid" data-state={state} role="status" aria-live="assertive">
      {state === 'paid' ? <Icon name="check" size={44} /> : state === 'failed' ? <Icon name="x" size={44} /> : <span className="spinner" aria-hidden />}
      <b className="num">{formatMoney(amount)}</b>
      <div className="paid-title">{t(`paid.${state}`)}</div>
      <div className="small">{t(`paid.${state}Help`)}</div>
      {state === 'stopped' && <button type="button" className="btn tinted" onClick={() => { setState('waiting'); setTick((n) => n + 1); }}>{t('paid.again')}</button>}
    </div>
  );
}
