// Paid in dollars: many traders are paid in US dollars but Kopor's books are in Leones. Type the dollars and the
// rate (today's rate from lib/freeApis.ts, or the rate the changer gave); Kopor fills in the Leone amount and notes
// "($20 @ Le 23.04)" so the record still shows it was a dollar payment.
import { useEffect, useState } from 'react';
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
  useEffect(() => { if (open && !rate) dollarRate().then((r) => r && setRate(r.rate.toFixed(2))).catch(() => {}); }, [open, rate]);
  if (!open) return <button type="button" className="link small" data-testid="usd-open" onClick={() => setOpen(true)}>{t('usd.open')}</button>;
  const u = Number(usd), r = Number(rate), le = u > 0 && r > 0 ? usdToLe(u, r) : 0;
  return (
    <div className="card flat stack" data-testid="usd">
      <div className="grid2">
        <label className="field"><span>{t('usd.dollars')}</span><input name="usd" inputMode="decimal" value={usd} placeholder="0" onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label className="field"><span>{t('usd.rate')}</span><input name="usd_rate" inputMode="decimal" value={rate} placeholder="23.00" onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></label>
      </div>
      {le > 0 && <button type="button" className="btn tinted block" data-testid="usd-use" onClick={() => { onUse(le, usdNote(u, r)); setOpen(false); setUsd(''); }}>{t('usd.use', { amount: formatMoney(le) })}</button>}
      <div className="small muted">{t('usd.help')}</div>
    </div>
  );
}
