// The shop's pay-QR poster (print and stick it at the counter) and the page a customer opens by scanning it: type the
// amount, pay with Orange Money, Afrimoney or a card through Monime, and the sale is recorded when Monime confirms.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { QrCode } from '@/ui/QrCode';
import { Empty, Field, MoneyInput } from '@/ui/widgets';
import { publicBase } from '@/lib/links';
import { posterInfo, posterPay, posterToken } from '@/cloud/payments';

/** Owner and managers: make (or renew) the poster and print it. */
export function PosterSheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { fail } = useOverlay();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { posterToken(ctx.orgId).then(setToken).catch((e) => fail(e)); }, [ctx.orgId, fail]);
  if (!token) return <div className="small muted">{t('poster.making')}</div>;
  const url = `${publicBase()}#/shop-pay/${token}`;
  return (
    <div className="stack">
      <div className="poster print-only" data-testid="poster">
        <div className="poster-name">{book.org.name}</div>
        <div className="poster-title">{t('poster.scan')}</div>
        <div className="poster-qr"><QrCode text={url} /></div>
        <div className="poster-how">{t('poster.how')}</div>
        <div className="poster-nets">Orange Money · Afrimoney · {t('poster.card')}</div>
        <div className="poster-foot">Kopor · Monime</div>
      </div>
      <div className="small muted no-print">{t('poster.help')}</div>
      <button type="button" className="btn primary block no-print" onClick={() => window.print()}><Icon name="print" size={18} /> {t('poster.print')}</button>
      <button type="button" className="btn ghost block no-print" onClick={async () => {
        if (!confirm(t('poster.renewAsk'))) return;
        try { setToken(await posterToken(ctx.orgId, true)); } catch (e) { fail(e); }
      }}>{t('poster.renew')}</button>
    </div>
  );
}

export function PosterPayRoute() { return <PosterPay token={useParams().token ?? ''} />; }

/** Public page (no account): the customer types the amount and pays. */
function PosterPay({ token }: { token: string }) {
  const { t } = useTranslation();
  const [shop, setShop] = useState<{ name: string; ready: boolean } | null | undefined>(undefined);
  const [amount, setAmount] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { posterInfo(token).then(setShop).catch(() => setShop(null)); }, [token]);
  if (shop === undefined) return <div className="boot"><div className="boot-logo">K</div></div>;
  if (!shop) return <div className="public"><Empty icon="alert" title={t('poster.gone')} /></div>;
  return (
    <div className="public pay-page" data-testid="poster-pay">
      <div className="card stack" style={{ textAlign: 'center' }}>
        <h1>{t('money.payTitle', { business: shop.name })}</h1>
        {!shop.ready && <div className="alert info"><Icon name="alert" /><div>{t('poster.notReady')}</div></div>}
      </div>
      {shop.ready && (
        <form className="form card" onSubmit={async (e) => {
          e.preventDefault();
          if (!(amount >= 100)) { setErr(t('err.amount')); return; }
          setBusy(true); setErr('');
          try { const r = await posterPay(token, amount, name); window.location.href = r.url; } catch { setErr(t('poster.failed')); setBusy(false); }
        }}>
          <Field label={t('poster.amount')}><MoneyInput name="amount" big required value={amount} onChange={setAmount} /></Field>
          <Field label={t('poster.yourName')}><input name="name" value={name} maxLength={40} placeholder={t('common.optional')} onChange={(e) => setName(e.target.value)} /></Field>
          {err && <div className="small bad">{err}</div>}
          <button className="btn get block" disabled={busy}><Icon name="send" size={18} /> {t('poster.pay')}</button>
          <div className="small muted">{t('poster.safe')}</div>
        </form>
      )}
    </div>
  );
}
