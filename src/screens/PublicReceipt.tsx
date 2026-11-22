// Public receipt check (#/r/CODE): anyone holding a Kopor receipt sees what Kopor's server has for that code, so a
// faked, edited or cancelled receipt is caught. Works without signing in; shows no phone numbers of customers.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSupabase } from '@/cloud/supabase';
import { formatMoney, setCurrencySymbol } from '@/lib/money';
import { useDate } from '@/ui/widgets';
import { Icon } from '@/ui/Icon';
import { cleanCode } from '@/domain/receipt';
import { LoadFailed } from './PublicStatement';

interface Checked {
  shop: string; shop_phone: string; currency: string; amount: number; date: string; method: string;
  items: { name: string; qty: number }[]; status: 'ok' | 'refunded' | 'cancelled'; confirmed: boolean;
}

export function PublicReceipt() {
  const { code = '' } = useParams();
  const { t } = useTranslation();
  const { fmt } = useDate();
  const nav = useNavigate();
  const key = cleanCode(code);
  // undefined = loading, null = no receipt with this code, 'error' = could not reach the server.
  const [r, setR] = useState<Checked | null | undefined | 'error'>(key ? undefined : null);
  const [attempt, setAttempt] = useState(0);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!key) return;
    getSupabase().then(async (sb) => {
      if (!sb) return setR(null);
      const { data, error } = await sb.rpc('public_receipt', { code: key }).abortSignal(AbortSignal.timeout(15_000));
      if (error) return setR('error');
      const row = data as Checked | null;
      if (row) setCurrencySymbol(row.currency);
      setR(row ?? null);
    }).catch(() => setR('error'));
  }, [key, attempt]);
  if (r === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (r === 'error') return <LoadFailed onRetry={() => { setR(undefined); setAttempt(attempt + 1); }} />;
  const good = r?.status === 'ok';
  return (
    <div className="shell" style={{ paddingBottom: 24 }}>
      <div className="content stack" style={{ paddingTop: 20 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{t('rcpt.checkTitle')}</h1>
        {code && <div className="small muted num">{t('rcpt.code')}: {code.toUpperCase()}</div>}
        {!r ? (
          <div className="alert bad" data-testid="receipt-missing"><Icon name="alert" /><div><b>{t('rcpt.notFound')}</b><br />{t('rcpt.notFoundHelp')}</div></div>
        ) : (
          <>
            <div className={`alert ${good ? 'good' : 'bad'}`} data-testid="receipt-result"><Icon name={good ? 'check' : 'alert'} />
              <div><b>{t(`rcpt.status.${r.status}`)}</b>{good && r.confirmed && <><br />{t('rcpt.confirmed')}</>}</div></div>
            <div className="doc stack">
              <div className="row between"><b>{r.shop}</b><span className="small">{fmt(r.date)}</span></div>
              {r.items.length > 0 && <div className="small">{r.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}</div>}
              <div className="row between"><span>{t('common.total')}</span><b className="num" style={{ fontSize: 22 }}>{formatMoney(Number(r.amount))}</b></div>
              <div className="small muted">{t(`methods.${r.method}`, { defaultValue: r.method })}</div>
            </div>
            <div className="small muted">{t('rcpt.compare')}</div>
          </>
        )}
        <form className="form" onSubmit={(e) => { e.preventDefault(); const k = cleanCode(typed); if (k) { setTyped(''); setR(undefined); nav(`/r/${k.toUpperCase()}`); } }}>
          <label className="field"><span>{t('rcpt.another')}</span><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="3F2A-9C1B-77D0" autoCapitalize="characters" /></label>
          <button className="btn block" disabled={!cleanCode(typed)}><Icon name="search" size={18} /> {t('rcpt.check')}</button>
        </form>
        <div className="small muted" style={{ textAlign: 'center' }}>Kopor</div>
      </div>
    </div>
  );
}
