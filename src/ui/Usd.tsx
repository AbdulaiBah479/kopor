// Paid in dollars: many traders are paid in US dollars but Kopor's books are in Leones. Type the dollars and the
// rate (today's rate from lib/freeApis.ts, or the rate the changer gave); Kopor fills in the Leone amount and notes
// "($20 @ Le 23.04)" so the record still shows it was a dollar payment.
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/money';
import { dollarRate } from '@/lib/freeApis';

/** Leones (minor units) for a dollar amount at a rate (Leones for one dollar). */
export const usdToLe = (usd: number, rate: number) => Math.round(usd * rate * 100);
export const usdNote = (usd: number, rate: number) => `($${usd.toFixed(2).replace(/\.00$/, '')} @ Le ${rate.toFixed(2)})`;

export function UsdHelper({ onUse }: { onUse: (amount: number, note: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [usd, setUsd] = useState('');
  const [rate, setRate] = useState('');
  // Once the person types a rate (what the changer really gave), today's fetched rate never replaces it.
  const typed = useRef(false);
  const rateBox = useRef<HTMLInputElement>(null);
  // Fill in today's rate once, without overwriting a rate the person typed, and never while they are typing in the
  // box (a rate arriving mid-typing used to land in front of what they typed: "22.93" + "23").
  useEffect(() => {
    if (open) dollarRate().then((r) => r && !typed.current && document.activeElement !== rateBox.current && setRate((cur) => cur || r.rate.toFixed(2))).catch(() => {});
  }, [open]);
  if (!open) return <button type="button" className="link small" data-testid="usd-open" onClick={() => setOpen(true)}>{t('usd.open')}</button>;
  const u = Number(usd), r = Number(rate), le = u > 0 && r > 0 ? usdToLe(u, r) : 0;
  return (
    <div className="card flat stack" data-testid="usd">
      <div className="grid2">
        <label className="field"><span>{t('usd.dollars')}</span><input name="usd" inputMode="decimal" value={usd} placeholder="0" onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label className="field"><span>{t('usd.rate')}</span><input ref={rateBox} name="usd_rate" inputMode="decimal" value={rate} onFocus={() => { typed.current = true; }} placeholder="23.00" onChange={(e) => { typed.current = true; setRate(e.target.value.replace(/[^\d.]/g, '')); }} /></label>
      </div>
      {le > 0 && <button type="button" className="btn tinted block" data-testid="usd-use" onClick={() => { onUse(le, usdNote(u, r)); setOpen(false); setUsd(''); }}>{t('usd.use', { amount: formatMoney(le) })}</button>}
      <div className="small muted">{t('usd.help')}</div>
    </div>
  );
}
