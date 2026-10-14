// Money hub: receive and send mobile money (Orange Money, Afrimoney, QMoney) from day one, without any partner
// account. Kopor shows customers where to pay, opens the network's own menu to send, and records the result.
// With Monime connected, payment links, USSD pay codes and payouts also confirm themselves.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Avatar, ContactPick, Empty, Field, MoneyInput, Seg, useDate } from '@/ui/widgets';
import { formatMoney, currencySymbol } from '@/lib/money';
import { shareText } from '@/lib/share';
import { getSupabase } from '@/cloud/supabase';
import { createPayLink, createUssdCode, monimeStatus } from '@/cloud/payments';
import { updateOrg } from '@/domain/org';
import { recordSale, recordExpense, itemsLabel, EXPENSE_CATEGORIES } from '@/domain/cash';
import { addEntry, balances, ensureContact } from '@/domain/credit';
import { DIAL_CODE, NETWORKS, NETWORK_NAME, decodePayRequest, dialLink, formatWallets, payLink, walletsOf, type Network, type Wallets } from '@/domain/wallets';
import type { Book } from '@/domain/book';
import { PayoutSheet } from './Groups';

const MOMO = new Set<string>(NETWORKS);

function useMonime() {
  const { ctx } = useApp();
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    getSupabase().then((sb) => sb && monimeStatus(ctx.orgId).then((s) => live && setOn(s.connected)).catch(() => {}));
    return () => { live = false; };
  }, [ctx.orgId]);
  return on;
}

const walletLines = (w: Wallets) => NETWORKS.filter((n) => w[n]).map((n) => `${NETWORK_NAME[n]}: ${w[n]}`).join('\n');

export function Money() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const monime = useMonime();
  const w = walletsOf(book.org);
  const has = NETWORKS.some((n) => w[n]);
  const contacts = new Map(book.contacts.map((c) => [c.id, c.name]));
  const history = [...book.txns].filter((x) => MOMO.has(x.method)).sort((a, b) => b.created_at - a.created_at).slice(0, 12);

  const receive = () => openSheet(t('money.receive'), <ReceiveSheet monime={monime} />);
  const send = () => openSheet(t('money.send'), <SendSheet monime={monime} />);
  const wallets = () => openSheet(t('money.wallets'), <WalletsSheet />);

  // Opened from Home's Receive/Send buttons: go straight to that sheet (once).
  const { state } = useLocation() as { state: { open?: 'receive' | 'send' } | null };
  const nav = useNavigate();
  useEffect(() => {
    if (!state?.open) return;
    if (state.open === 'receive') receive(); else send();
    nav('.', { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per navigation
  }, [state]);

  return (
    <Page title={t('money.title')} sub={t('money.sub')} back="/" guide="money">
      <div className="money-actions">
        <button className="btn primary" onClick={receive} data-testid="money-receive"><Icon name="down" size={20} /> {t('money.receive')}</button>
        <button className="btn tinted" onClick={send} data-testid="money-send"><Icon name="up" size={20} /> {t('money.send')}</button>
      </div>

      <div className="section-title"><span>{t('money.wallets')}</span>{has && can('business') && <button className="link" onClick={wallets}>{t('money.edit')}</button>}</div>
      {has ? (
        <div className="list">
          {NETWORKS.filter((n) => w[n]).map((n) => (
            <div key={n} className="item">
              <span className={`tile net-${n}`} aria-hidden="true"><Icon name="wallet" size={18} /></span>
              <div className="main"><div className="t">{NETWORK_NAME[n]}</div><div className="s num">{w[n]}</div></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card stack">
          <div className="small">{t('money.noWallets')}</div>
          {can('business') && <button className="btn primary block" onClick={wallets} data-testid="add-wallets"><Icon name="plus" size={18} /> {t('money.addWallets')}</button>}
        </div>
      )}

      <div className="card stack">
        <h3><Icon name="link" size={18} /> {t('money.instantTitle')}</h3>
        <div className="small muted">{t('money.instantHelp')}</div>
        {!monime && can('business') && <Link className="btn ghost block" to="/payments">{t('money.connect')}</Link>}
        {monime && <div className="badge good">{t('pay.connected')}</div>}
      </div>

      <div className="alert small"><Icon name="shield" /><div>{t('money.safety')} {t('money.notWallet')}</div></div>

      <div className="section-title"><span>{t('money.history')}</span></div>
      <div className="list">
        {history.length ? history.map((x) => (
          <div key={x.id} className="item">
            <span className={`icon-dot ${x.type === 'in' ? 'bg-primary-soft text-positive' : 'bg-warning-soft text-warning'}`}><Icon name={x.type === 'in' ? 'down' : 'up'} size={20} /></span>
            <div className="main">
              <div className="t">{itemsLabel(x.items) || x.note || (x.contact_id && contacts.get(x.contact_id)) || t(`categories.${x.category}`)}</div>
              <div className="s">{t(`methods.${x.method}`)} · {fmt(x.date)}</div>
            </div>
            <div className={`amt ${x.type === 'in' ? 'good' : ''}`}>{x.type === 'in' ? '+' : '−'}{formatMoney(x.amount)}</div>
          </div>
        )) : <Empty icon="wallet" title={t('pay.noRequests')} />}
      </div>
    </Page>
  );
}

export function WalletsSheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [w, setW] = useState<Wallets>(walletsOf(book.org));
  return (
    <form className="form" data-testid="wallets-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await updateOrg(ctx, { momo_number: formatWallets(w) }); closeSheet(); toast(t('common.saved')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('money.walletsHelp')}</div>
      {NETWORKS.map((n) => (
        <Field key={n} label={t(`money.${n}`)}>
          <input name={`wallet_${n}`} type="tel" inputMode="tel" autoComplete="off" value={w[n] ?? ''} placeholder="07X XXX XXX"
            onChange={(e) => setW({ ...w, [n]: e.target.value.replace(/[^\d+ ]/g, '') })} />
        </Field>
      ))}
      <button className="btn primary block"><Icon name="check" size={18} /> {t('money.saveWallets')}</button>
    </form>
  );
}

function QrCode({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    import('qrcode').then((q) => q.toDataURL(text, { margin: 1, width: 260, errorCorrectionLevel: 'M' })).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [text]);
  return src ? <img className="qr" src={src} alt="" width={260} height={260} /> : <div className="qr" />;
}

function ReceiveSheet({ monime }: { monime: boolean }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ amount: 0, reason: '', from: '' });
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const w = walletsOf(book.org);
  const has = NETWORKS.some((n) => w[n]);
  const contact = book.contacts.find((c) => c.name.toLowerCase() === f.from.trim().toLowerCase());
  const link = payLink({ b: book.org.name, a: f.amount, c: currencySymbol(), r: f.reason.trim() || undefined, w: NETWORKS.filter((n) => w[n]).map((n) => [n, w[n]!] as [Network, string]) });
  const message = (extraLink = link) => t('money.requestMsg', {
    name: f.from.trim() ? ` ${f.from.trim().split(' ')[0]}` : '', amount: f.amount ? formatMoney(f.amount) : '', business: book.org.name,
    reason: f.reason.trim() ? ` (${f.reason.trim()})` : '', wallets: walletLines(w), link: extraLink,
  }).replace(/ {2,}/g, ' ');

  const auto = async (kind: 'link' | 'ussd') => {
    if (!(f.amount > 0)) { fail(new Error('err.amount')); return; }
    setBusy(true);
    try {
      const name = f.reason.trim() || f.from.trim() || book.org.name;
      if (kind === 'link') { const r = await createPayLink(ctx.orgId, { amount: f.amount, name }); await shareText(message(r.url), contact?.phone, book.org.country_code); }
      else { const r = await createUssdCode(ctx.orgId, { amount: f.amount, name, phone: contact?.phone }); await shareText(`${message('')}\nUSSD: ${r.ussdCode}`, contact?.phone, book.org.country_code); toast(`USSD: ${r.ussdCode}`); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <div className="form" data-testid="receive-form">
      {!has && <div className="alert small"><Icon name="alert" /><div>{t('money.noWallets')}</div></div>}
      <Field label={t('money.amount')}><MoneyInput big name="amount" value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('money.from')}>
        <input name="from" list="money-contacts" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} autoComplete="off" />
        <datalist id="money-contacts">{book.contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      </Field>
      <Field label={t('money.reason')}><input name="reason" value={f.reason} placeholder={t('money.reasonPh')} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={!has} onClick={() => shareText(message(), contact?.phone, book.org.country_code)} data-testid="share-request"><Icon name="chat" size={18} /> {t('money.shareRequest')}</button>
        <button type="button" className="btn tinted" disabled={!has} onClick={() => setQr(!qr)} data-testid="show-qr"><Icon name="qr" size={18} /> {t('money.showQr')}</button>
      </div>
      {qr && has && <div className="qr-wrap"><QrCode text={link} /><div className="small muted">{t('money.qrHelp')}</div></div>}
      {monime && (
        <div className="btn-row">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => auto('link')}><Icon name="link" size={18} /> {t('money.instantLink')}</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => auto('ussd')}><Icon name="phone" size={18} /> {t('money.instantUssd')}</button>
        </div>
      )}
      <button type="button" className="btn get block" data-testid="money-got"
        onClick={() => openSheet(t('money.got'), <RecordInSheet amount={f.amount} from={f.from} note={f.reason} />)}>
        <Icon name="check" size={18} /> {t('money.got')}
      </button>
    </div>
  );
}

const debtors = (book: Book) => { const bal = balances(book.ledger); return book.contacts.filter((c) => (bal.get(c.id) ?? 0) > 0).map((c) => ({ c, b: bal.get(c.id)! })); };

function RecordInSheet({ amount: a0 = 0, from = '', note = '' }: { amount?: number; from?: string; note?: string }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const owing = debtors(book);
  const preset = owing.find((d) => d.c.name.toLowerCase() === from.trim().toLowerCase());
  const [f, setF] = useState({ amount: a0, net: (NETWORKS.find((n) => walletsOf(book.org)[n]) ?? 'orange') as Network, as: (preset ? 'debt' : 'sale') as 'sale' | 'debt', contactId: preset?.c.id ?? '', note });
  return (
    <form className="form" data-testid="record-in-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        if (f.as === 'debt') {
          if (!f.contactId) throw new Error('err.nameRequired');
          if (!(f.amount > 0)) throw new Error('err.amount');
          await addEntry(ctx, { contactId: f.contactId, type: 'got', amount: f.amount, note: [NETWORK_NAME[f.net], f.note.trim()].filter(Boolean).join(' · ') });
        } else await recordSale(ctx, { amount: f.amount, method: f.net, note: f.note.trim(), customer: from.trim() || undefined });
        closeSheet(); toast(t('money.recorded'));
      } catch (err) { fail(err); }
    }}>
      <Field label={t('common.amount')}><MoneyInput big required name="amount" value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <Field label={t('money.network')}><Seg value={f.net} onChange={(net) => setF({ ...f, net })} options={NETWORKS.map((n) => [n, NETWORK_NAME[n]] as [Network, string])} /></Field>
      <Field label={t('money.recordAs')}>
        <select name="as" value={f.as} onChange={(e) => setF({ ...f, as: e.target.value as 'sale' | 'debt' })}><option value="sale">{t('money.asSale')}</option><option value="debt">{t('money.asDebt')}</option></select>
      </Field>
      {f.as === 'debt' && (
        <Field label={t('money.pickCustomer')}>
          <select name="contact" required value={f.contactId} onChange={(e) => { const d = owing.find((x) => x.c.id === e.target.value); setF({ ...f, contactId: e.target.value, amount: f.amount || d?.b || 0 }); }}>
            <option value="">—</option>
            {owing.map(({ c, b }) => <option key={c.id} value={c.id}>{c.name} · {formatMoney(b)}</option>)}
          </select>
        </Field>
      )}
      <Field label={t('common.note')}><input name="note" value={f.note} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <button className="btn get block"><Icon name="check" size={18} /> {t('common.save')}</button>
    </form>
  );
}

function SendSheet({ monime }: { monime: boolean }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, closeSheet, toast, fail } = useOverlay();
  const suppliers = book.contacts.filter((c) => c.kind === 'supplier');
  const [f, setF] = useState({ net: 'orange' as Network, phone: '', name: '', amount: 0, note: '', as: 'expense' as 'expense' | 'supplier' | 'loan', category: 'stock', contactId: '', code: DIAL_CODE.orange });
  const code = f.code.trim();
  const amountText = f.amount ? formatMoney(f.amount) : t('common.amount').toLowerCase();

  const record = async () => {
    try {
      if (!(f.amount > 0)) throw new Error('err.amount');
      const note = [f.name.trim() || f.phone.trim(), f.note.trim()].filter(Boolean).join(' · ');
      if (f.as === 'expense') await recordExpense(ctx, { amount: f.amount, category: f.category, method: f.net, note });
      else {
        const contact = f.as === 'supplier' && f.contactId ? book.contacts.find((c) => c.id === f.contactId)!
          : await ensureContact(ctx, f.name.trim() || f.phone.trim(), f.phone.trim(), f.as === 'supplier' ? 'supplier' : 'customer');
        await addEntry(ctx, { contactId: contact.id, type: 'gave', amount: f.amount, note: [NETWORK_NAME[f.net], f.note.trim()].filter(Boolean).join(' · ') });
      }
      closeSheet(); toast(t('money.recorded'));
    } catch (err) { fail(err); }
  };

  return (
    <div className="form" data-testid="send-form">
      <div className="small muted">{t('money.sendHelp')}</div>
      <Field label={t('money.network')}>
        <Seg value={f.net} onChange={(net) => setF({ ...f, net, code: DIAL_CODE[net] })} options={NETWORKS.map((n) => [n, NETWORK_NAME[n]] as [Network, string])} />
      </Field>
      <Field label={t('money.to')}>
        <input name="phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^\d+ ]/g, '') })} />
      </Field>
      <ContactPick onPick={(c) => setF({ ...f, phone: c.phone, name: c.name })} />
      <Field label={t('common.amount')}><MoneyInput big name="amount" value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      {!DIAL_CODE[f.net] && <Field label={t('money.dialCode')}><input name="code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/[^\d*#]/g, '') })} placeholder="*…#" /></Field>}
      <div className="card flat small">{t('money.steps', { phone: f.phone || '…', amount: amountText })}</div>
      {code
        ? <a className="btn primary block" href={dialLink(code)} data-testid="dial"><Icon name="phone" size={18} /> {t('money.dial', { network: NETWORK_NAME[f.net], code })}</a>
        : <div className="alert small"><Icon name="phone" /><div>{t('money.noDial', { network: NETWORK_NAME[f.net] })}</div></div>}
      {monime && can('payouts') && (
        <button type="button" className="btn ghost block" onClick={() => openSheet(t('pay.payout'), <PayoutSheet amount={f.amount} />)}><Icon name="send" size={18} /> {t('money.autoSend')}</button>
      )}

      <hr className="sep" />
      <Field label={t('money.sendAs')}>
        <select name="as" value={f.as} onChange={(e) => setF({ ...f, as: e.target.value as 'expense' | 'supplier' | 'loan', contactId: '' })}>
          {(['expense', 'supplier', 'loan'] as const).map((k) => <option key={k} value={k}>{t(`money.as${k[0].toUpperCase()}${k.slice(1)}`)}</option>)}
        </select>
      </Field>
      {f.as === 'expense' && (
        <Field label={t('cash.category')}>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select>
        </Field>
      )}
      {f.as === 'supplier' && suppliers.length > 0 && (
        <Field label={t('credit.supplier')}>
          <select value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}><option value="">{f.name || '—'}</option>{suppliers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
      )}
      {f.as !== 'expense' && !f.contactId && <Field label={t('common.name')}><input name="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
      <Field label={t('common.note')}><input name="note" value={f.note} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <button type="button" className="btn give block" onClick={record} data-testid="sent-record"><Icon name="check" size={18} /> {t('money.sentRecord')}</button>
      <div className="small muted">{t('money.safety')}</div>
    </div>
  );
}

export function PayRoute() { return <PayPage data={useParams().data ?? ''} />; }

/** Public page a customer opens from a pay-me link or QR code (no account needed). */
export function PayPage({ data }: { data: string }) {
  const { t } = useTranslation();
  const p = decodePayRequest(data);
  if (!p || !p.w.length) return <div className="public"><Empty icon="alert" title={t('money.invalidLink')} /></div>;
  const copy = (s: string) => navigator.clipboard?.writeText(s).catch(() => {});
  return (
    <div className="public pay-page">
      <div className="card stack" style={{ textAlign: 'center' }}>
        <Avatar name={p.b} size={56} />
        <h1>{t('money.payTitle', { business: p.b })}</h1>
        {p.a > 0 && <div className="pay-amount">{p.c} {formatMoney(p.a, { symbol: false })}</div>}
        {p.r && <div className="muted">{p.r}</div>}
      </div>
      <div className="section-title"><span>{t('money.payWith')}</span></div>
      <div className="list">
        {p.w.map(([n, num]) => (
          <div key={n} className="item">
            <span className={`tile net-${n}`} aria-hidden="true"><Icon name="wallet" size={18} /></span>
            <div className="main"><div className="t">{NETWORK_NAME[n]}</div><div className="s num">{num}</div></div>
            <button className="icon-btn filled" onClick={() => copy(num)} aria-label={t('money.copyNumber')}><Icon name="copy" size={18} /></button>
            {DIAL_CODE[n] && <a className="icon-btn filled" href={dialLink(DIAL_CODE[n])} aria-label={`${NETWORK_NAME[n]} ${DIAL_CODE[n]}`}><Icon name="phone" size={18} /></a>}
          </div>
        ))}
      </div>
      <div className="small muted" style={{ textAlign: 'center' }}>{t('money.payNote', { business: p.b })}</div>
      <div className="small muted" style={{ textAlign: 'center' }}>{t('money.poweredBy')}</div>
    </div>
  );
}
