// Today's US dollar rate and a quick converter, for traders who buy goods in dollars (lib/freeApis.ts).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, MoneyInput, useDate } from './widgets';
import { formatMoney } from '@/lib/money';
import { dollarRate, type DollarRate } from '@/lib/freeApis';

export function DollarCard() {
  const { t } = useTranslation();
  const [r, setR] = useState<DollarRate | null | undefined>(undefined);
  const [usd, setUsd] = useState(0); // in cents, like every amount in Kopor
  const { fmt } = useDate();
  useEffect(() => { dollarRate().then(setR).catch(() => setR(null)); }, []);
  if (!r) return null;
  return (
    <details className="card" data-testid="dollar-card">
      <summary><b>{t('fx.title', { rate: r.rate.toFixed(2) })}</b>{!r.fresh && <span className="small muted"> · {t('fx.old')}</span>}
        <div className="small muted" data-testid="fx-source">{t(r.kind === 'official' ? 'fx.official' : 'fx.market', { date: fmt(r.date) })}</div></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <Field label={t('fx.usd')}><MoneyInput name="usd" value={usd} onChange={setUsd} /></Field>
        {usd > 0 && <div><b className="num">{formatMoney(Math.round(usd * r.rate))}</b></div>}
        <div className="small muted">{t('fx.source')}</div>
      </div>
    </details>
  );
}
