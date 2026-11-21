// Wallet actions beyond "send to mobile money": add money, send to a bank account, and pay another Kopor shop
// instantly (scan its pay QR). The money is held and moved by Monime (licensed by the Bank of Sierra Leone);
// every payment out needs the owner's PIN and counts towards the daily limit set in Settings.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Icon } from '@/ui/Icon';
import { Field, MoneyInput } from '@/ui/widgets';
import { ScanToggle } from '@/ui/extras';
import { formatMoney } from '@/lib/money';
import { checkPin, hasPin } from '@/domain/org';
import { payTokenOf } from '@/domain/payLink';
import { bankList, bankPayout, payShop, paymentStatus, shopToPay, walletTopUp } from '@/cloud/payments';

/** The owner's PIN field for money leaving the wallet (shared by the bank and shop sheets). */
function usePin() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const [pin, setPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  useEffect(() => { if (ctx.memberId) hasPin(ctx.memberId).then(setNeedPin).catch(() => {}); }, [ctx.memberId]);
  const field = needPin
    ? <Field label={t('safe.pinToSend')}><input type="password" inputMode="numeric" autoComplete="off" required name="wallet_pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
    : <div className="small muted">{t('safe.setPinFirst')}</div>;
  const verify = async () => {
    if (needPin && !(await checkPin(ctx.memberId!, pin))) { setPin(''); throw new Error(t('err.login')); }
  };
  return { field, verify };
}

/** Add money: the owner pays into their own wallet on Monime's page (mobile money, card or bank). */
export function TopUpSheet() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, fail } = useOverlay();
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <form className="form" data-testid="topup-form" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try { const { url } = await walletTopUp(ctx.orgId, amount); closeSheet(); window.location.assign(url); } catch (err) { fail(err); } finally { setBusy(false); }
    }}>
      <div className="small muted">{t('walletx.topupHelp')}</div>
      <Field label={t('common.amount')}><MoneyInput big required value={amount} onChange={setAmount} /></Field>
      <button className="btn primary block" disabled={busy || amount < 100}><Icon name="down" size={18} /> {t('walletx.topupGo')}</button>
    </form>
  );
}

/** Send from the wallet to a bank account in Sierra Leone. */
export function BankSheet() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [banks, setBanks] = useState<{ id: string; name: string }[] | null>(null);
  const [f, setF] = useState({ amount: 0, providerId: '', accountNumber: '', note: '' });
  const { field, verify } = usePin();
  useEffect(() => {
    bankList(ctx.orgId).then((r) => { setBanks(r.banks); setF((x) => ({ ...x, providerId: r.banks[0]?.id ?? '' })); }).catch((e) => { setBanks([]); fail(e); });
  }, [ctx.orgId, fail]);
  const bankName = banks?.find((b) => b.id === f.providerId)?.name ?? '';
  return (
    <form className="form" data-testid="bank-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!confirm(t('walletx.bankConfirm', { amount: formatMoney(f.amount), bank: bankName, account: f.accountNumber }))) return;
      try { await verify(); await bankPayout(ctx.orgId, f); closeSheet(); toast(t('pay.sent')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('walletx.bankHelp')}</div>
      <Field label={t('common.amount')}><MoneyInput big required value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('walletx.bank')}>
        <select required value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}>{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </Field>
      <Field label={t('walletx.account')}><input inputMode="numeric" required pattern="[0-9 ]{6,30}" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Field>
      <Field label={t('common.note')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {field}
      <button className="btn primary block" disabled={!banks?.length}><Icon name="send" size={18} /> {t('walletx.bankGo')}</button>
    </form>
  );
}

/** Pay a Kopor shop: scan its pay QR (or paste its link), check the name, pay instantly from the wallet. */
export function PayShopSheet() {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [link, setLink] = useState('');
  const [shop, setShop] = useState<{ token: string; name: string; ready: boolean } | null>(null);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { field, verify } = usePin();

  const look = async (text: string) => {
    const token = payTokenOf(text);
    if (!token) { fail(new Error('errx.notPayLink')); return; }
    try { setShop({ token, ...(await shopToPay(ctx.orgId, token)) }); } catch (err) { fail(err); }
  };

  if (!shop) return (
    <form className="form" data-testid="payshop-find" onSubmit={(e) => { e.preventDefault(); void look(link); }}>
      <div className="small muted">{t('walletx.shopHelp')}</div>
      <ScanToggle label={t('walletx.scanShop')} onCode={(c) => { setLink(c); void look(c); }} />
      <Field label={t('walletx.shopLink')}><input required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…#/shop-pay/…" /></Field>
      <button className="btn primary block"><Icon name="search" size={18} /> {t('walletx.findShop')}</button>
    </form>
  );
  return (
    <form className="form" data-testid="payshop-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!confirm(t('walletx.shopConfirm', { amount: formatMoney(amount), name: shop.name }))) return;
      setBusy(true);
      try {
        await verify();
        const r = await payShop(ctx.orgId, { token: shop.token, amount, note });
        // Usually instant; if Monime is still moving it, check a few times before saying "on its way".
        let status = r.status;
        for (let i = 0; i < 4 && (status === 'pending' || status === 'processing'); i++) {
          await new Promise((ok) => setTimeout(ok, 1500));
          status = (await paymentStatus(ctx.orgId, r.requestId)).status;
        }
        if (status === 'failed') throw new Error('errx.transferFailed');
        closeSheet();
        toast(t(status === 'completed' ? 'walletx.shopPaid' : 'walletx.shopOnWay', { amount: formatMoney(amount), name: r.name }));
      } catch (err) { fail(err); } finally { setBusy(false); }
    }}>
      <div className="card flat row" data-testid="payshop-name"><Icon name="store" size={20} /><b>{shop.name}</b></div>
      {!shop.ready ? <div className="alert small" role="alert"><Icon name="alert" /><div>{t('walletx.shopNotReady')}</div></div> : (
        <>
          <Field label={t('common.amount')}><MoneyInput big required value={amount} onChange={setAmount} /></Field>
          <Field label={t('common.note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {field}
          <button className="btn primary block" disabled={busy || amount < 100}><Icon name="send" size={18} /> {t('walletx.shopGo', { name: shop.name })}</button>
        </>
      )}
      <button type="button" className="btn ghost block" onClick={() => setShop(null)}>{t('walletx.otherShop')}</button>
    </form>
  );
}
