import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, ItemsEditor, Search, useDate } from '@/ui/widgets';
import { formatMoney } from '@/lib/money';
import { today, addDays } from '@/lib/dates';
import { waLink } from '@/lib/phone';
import { publicLink } from '@/lib/links';
import type { Invoice, LineItem, Method } from '@/db/schema';
import { itemsTotal, METHODS } from '@/domain/cash';
import { createInvoice, createQuote, acceptQuote, markInvoicePaid, voidInvoice, invoiceCode, invoiceTotal, docKind } from '@/domain/invoices';
import { computeTotals, taxSettings } from '@/domain/tax';
import { ActionButton, ScanToggle, TotalsBlock } from '@/ui/extras';
import { MoneyInput } from '@/ui/widgets';
import { shareFile } from '@/lib/share';
import { createCheckout, createUssdCode } from '@/cloud/payments';

const isOverdue = (i: Invoice) => i.status === 'unpaid' && !!i.due_date && i.due_date < today();
const badgeOf = (i: Invoice): [string, string] =>
  i.status === 'paid' ? ['good', 'inv.paid'] : i.status === 'void' ? ['', 'inv.void'] : i.status === 'quote' ? ['', 'quote.badge']
    : i.status === 'accepted' ? ['good', 'quote.accepted'] : isOverdue(i) ? ['bad', 'inv.overdue'] : ['warn', 'inv.unpaid'];

export function InvoiceList() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const [q, setQ] = useState('');
  const list = [...book.invoices].sort((a, b) => b.number.localeCompare(a.number)).filter((i) => !q || `${i.number} ${i.customer}`.toLowerCase().includes(q.toLowerCase()));
  const unpaid = book.invoices.filter((i) => i.status === 'unpaid');
  return (
    <Page guide="invoices" title={t('inv.title')} sub={t('inv.sub', { count: unpaid.length, amount: formatMoney(unpaid.reduce((s, i) => s + invoiceTotal(i), 0)) })} back="/more"
      fab={can('record') && <button className="fab" onClick={() => openSheet(t('inv.new'), <NewInvoiceSheet />)}><Icon name="plus" /> {t('inv.new')}</button>}>
      {can('record') && <button className="btn ghost block" data-testid="new-quote" onClick={() => openSheet(t('quote.new'), <NewInvoiceSheet kind="quote" />)}><Icon name="file" size={18} /> {t('quote.new')}</button>}
      {book.invoices.length > 4 && <Search value={q} onChange={setQ} placeholder={t('common.search')} />}
      <div className="list">
        {list.length ? list.map((inv) => (
          <Link key={inv.id} className="item" to={`/invoices/${inv.id}`}>
            <div className="avatar"><Icon name="file" size={18} /></div>
            <div className="main">
              <div className="t">{inv.customer} <span className={`badge ${badgeOf(inv)[0]}`}>{t(badgeOf(inv)[1])}</span></div>
              <div className="s">{inv.number} · {fmt(inv.date)}</div>
            </div>
            <div className="amt num">{formatMoney(invoiceTotal(inv))}</div>
          </Link>
        )) : <Empty icon="file" title={t('inv.none')} text={t('inv.noneHelp')} />}
      </div>
    </Page>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { openSheet, toast, fail } = useOverlay();
  const { fmt, loc } = useDate();
  const inv = book.invoices.find((i) => i.id === id);
  if (!inv) return <Page title={t('err.notFound')} back="/invoices"><Empty icon="file" title={t('err.notFound')} /></Page>;
  const org = book.org;
  const total = invoiceTotal(inv);
  const code = invoiceCode(org.name, inv);
  const paid = inv.status === 'paid';
  const quote = inv.status === 'quote' || inv.status === 'accepted';
  const publicUrl = publicLink(`/i/${inv.public_token}`);
  const share = t('inv.shareMsg', {
    kind: t(docKind(inv)), number: inv.number, business: org.name, date: fmt(inv.date),
    lines: inv.items.map((i) => `• ${i.qty} × ${i.name}: ${formatMoney(i.qty * i.price)}`).join('\n'), total: formatMoney(total),
    extra: quote ? `${inv.due_date ? `\n${t('quote.extra', { date: fmt(inv.due_date) })}` : ''}\n${t('quote.notice')}\n${publicUrl}`
      : paid ? '\n✅ ' + t('inv.paid') : `${inv.due_date ? `\n${t('inv.due')}: ${fmt(inv.due_date)}` : ''}${org.momo_number ? `\n${t('inv.payMomo')}: ${org.momo_number}` : ''}`, code,
  });

  const payLink = async () => {
    try {
      const r = await createCheckout(ctx.orgId, inv.id);
      openSheet(t('inv.payLink'), <div className="stack"><input className="input" readOnly value={r.url} onFocus={(e) => e.target.select()} />
        <a className="btn get block" target="_blank" rel="noopener noreferrer" href={waLink(inv.phone, `${share}\n\n${t('public.pay')}: ${r.url}`, org.country_code)}><Icon name="chat" size={18} /> {t('common.whatsapp')}</a></div>);
    } catch (e) { fail(e); }
  };
  const ussd = async () => {
    try {
      const r = await createUssdCode(ctx.orgId, { invoiceId: inv.id, amount: total, name: `${org.name} ${inv.number}`.slice(0, 60), phone: inv.phone });
      openSheet(t('inv.ussd'), <div className="stack"><div className="code-box">{r.ussdCode}</div>
        <a className="btn get block" target="_blank" rel="noopener noreferrer" href={waLink(inv.phone, `${share}\n\nUSSD: ${r.ussdCode}`, org.country_code)}><Icon name="chat" size={18} /> {t('common.whatsapp')}</a></div>);
    } catch (e) { fail(e); }
  };

  return (
    <Page title={inv.number} sub={t(badgeOf(inv)[1])} back="/invoices">
      <div className="doc">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><h2>{org.name}</h2><div className="small">{org.address}{org.phone && <><br />{org.phone}</>}</div></div>
          <div style={{ textAlign: 'right' }}>
            <b style={{ fontSize: 18 }}>{t(docKind(inv))}</b><div className="small">{inv.number}</div>
            <div className="stamp" style={{ color: paid || inv.status === 'accepted' ? '#0b7a3b' : quote ? '#1d4ed8' : '#a8650a', marginTop: 6 }}>{t(quote || paid || inv.status === 'void' ? badgeOf(inv)[1] : 'inv.due').toUpperCase()}</div>
          </div>
        </div>
        <div className="meta" style={{ marginTop: 16 }}>
          <div><div className="small">{t('inv.billTo')}</div><b>{inv.customer}</b>{inv.phone && <><br />{inv.phone}</>}</div>
          <div style={{ textAlign: 'right' }} className="small">
            <div>{t('common.date')}: {fmt(inv.date)}</div>
            {!paid && inv.due_date && <div>{t(quote ? 'quote.validUntil' : 'inv.due')}: {fmt(inv.due_date)}</div>}
            {paid && <div>{t('inv.paidOn')}: {fmt(inv.paid_date)}</div>}
          </div>
        </div>
        <table>
          <thead><tr><th>{t('common.item')}</th><th className="r">{t('common.qty')}</th><th className="r">{t('common.price')}</th><th className="r">{t('common.amount')}</th></tr></thead>
          <tbody>
            {inv.items.map((i, k) => <tr key={k}><td>{i.name}</td><td className="r">{i.qty}</td><td className="r">{formatMoney(i.price)}</td><td className="r">{formatMoney(i.qty * i.price)}</td></tr>)}
            {(inv.discount || inv.tax) ? <tr><td colSpan={3}>{t('tax.subtotal')}</td><td className="r">{formatMoney(itemsTotal(inv.items))}</td></tr> : null}
            {inv.discount ? <tr><td colSpan={3}>{t('tax.discount')}</td><td className="r">-{formatMoney(inv.discount)}</td></tr> : null}
            {inv.tax ? <tr><td colSpan={3}>{t('tax.tax')} ({org.tax_rate}%{org.tax_inclusive ? `, ${t('tax.included')}` : ''})</td><td className="r">{formatMoney(inv.tax)}</td></tr> : null}
            <tr className="tot"><td colSpan={3}>{t('common.total')}</td><td className="r">{formatMoney(total)}</td></tr>
          </tbody>
        </table>
        {inv.notes && <div className="small">{inv.notes}</div>}
        {inv.status === 'unpaid' && org.momo_number && <div className="small" style={{ marginTop: 8 }}><b>{t('inv.payMomo')}:</b> {org.momo_number}</div>}
        {quote && <div className="small" style={{ marginTop: 8 }}>{t('quote.notice')}</div>}
        <div className="foot">{t('inv.verify')}: <b>{code}</b> · {t('inv.generated')}</div>
      </div>
      <div className="btn-row no-print">
        <a className="btn get" href={waLink(inv.phone, share, org.country_code)} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={18} /> {t('common.whatsapp')}</a>
        <ActionButton icon="download" label={t('export.pdf')} testId="invoice-pdf" run={async () => {
          try {
            const { invoicePdf } = await import('@/features/pdf');
            await shareFile(invoicePdf(book, inv, t, loc), `${inv.number}.pdf`, inv.number);
          } catch (e) { fail(e); }
        }} />
      </div>
      <div className="btn-row no-print">
        <button className="btn" onClick={() => window.print()}><Icon name="print" size={18} /> {t('common.print')}</button>
        <ActionButton icon="print" label={t('printer.print')} run={async () => {
          try {
            const p = await import('@/features/printer');
            await p.printBytes(p.receiptBytes(book, { invoice: inv }, t, (await p.getPrinter()).width));
            toast(t('printer.sent'));
          } catch (e) { fail(e); }
        }} />
      </div>
      {inv.status === 'quote' && (
        <>
          <button className="btn ghost block no-print" onClick={() => navigator.clipboard?.writeText(publicUrl).then(() => toast(t('common.copied')))}><Icon name="link" size={18} /> {t('inv.publicLink')}</button>
          {can('record') && <button className="btn primary block no-print" data-testid="accept-quote" onClick={() => openSheet(t('quote.accept'), <AcceptQuoteSheet quote={inv} />)}><Icon name="check" size={18} /> {t('quote.accept')}</button>}
          {can('edit') && <button className="btn danger block no-print" onClick={() => confirm(t('common.confirm')) && voidInvoice(ctx, inv.id).then(() => toast(t('quote.cancelled'))).catch(fail)}>{t('quote.cancel')}</button>}
        </>
      )}
      {inv.status === 'unpaid' && (
        <>
          {can('payments') && (
            <div className="btn-row no-print">
              <button className="btn" onClick={payLink}><Icon name="link" size={18} /> {t('inv.getPayLink')}</button>
              <button className="btn" onClick={ussd}><Icon name="phone" size={18} /> {t('inv.getUssd')}</button>
            </div>
          )}
          <button className="btn ghost block no-print" onClick={() => navigator.clipboard?.writeText(publicUrl).then(() => toast(t('common.copied')))}><Icon name="link" size={18} /> {t('inv.publicLink')}</button>
          <div className="btn-row no-print">
            <button className="btn primary" onClick={() => markInvoicePaid(ctx, inv.id).then(() => toast(t('inv.markedPaid'))).catch(fail)}><Icon name="check" size={18} /> {t('inv.markPaid')}</button>
            {can('edit') && <button className="btn danger" onClick={() => confirm(t('common.confirm')) && voidInvoice(ctx, inv.id).catch(fail)}>{t('inv.voidIt')}</button>}
          </div>
        </>
      )}
    </Page>
  );
}

/** The customer accepted: choose paid now or later, then the real invoice is created. */
function AcceptQuoteSheet({ quote }: { quote: Invoice }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const nav = useNavigate();
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState<Method>('cash');
  const [dueDate, setDueDate] = useState(addDays(today(), 7));
  return (
    <form className="form" data-testid="accept-form" onSubmit={async (e) => {
      e.preventDefault();
      try { const inv = await acceptQuote(ctx, quote.id, { paid, method, dueDate }); closeSheet(); toast(t('quote.done')); nav(`/invoices/${inv.id}`); } catch (err) { fail(err); }
    }}>
      <div className="card flat row between"><span>{quote.customer} · {quote.number}</span><b className="num">{formatMoney(invoiceTotal(quote))}</b></div>
      <Field label={t('inv.status')}>
        <select value={paid ? 'paid' : 'unpaid'} onChange={(e) => setPaid(e.target.value === 'paid')}>
          <option value="unpaid">{t('quote.payLater')}</option><option value="paid">{t('quote.paidNow')}</option>
        </select>
      </Field>
      {paid
        ? <Field label={t('cash.paidWith')}><select value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.filter((m) => m !== 'credit').map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select></Field>
        : <Field label={t('common.dueDate')}><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
      <button className="btn primary block">{t('quote.accept')}</button>
    </form>
  );
}

function NewInvoiceSheet({ kind = 'invoice' }: { kind?: 'invoice' | 'quote' }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, fail } = useOverlay();
  const nav = useNavigate();
  const isQuote = kind === 'quote';
  const [items, setItems] = useState<Partial<LineItem>[]>([]);
  const [f, setF] = useState({ customer: '', phone: '', date: today(), dueDate: addDays(today(), isQuote ? 14 : 7), notes: '', paid: false, method: 'cash' as Method, discount: 0 });
  const real = items.filter((i) => i.name?.trim());
  const totals = computeTotals(itemsTotal(real.map((i) => ({ product_id: null, name: '', cost: 0, qty: i.qty ?? 0, price: i.price ?? 0 }))), f.discount, taxSettings(book.org));
  const addScanned = (code: string) => {
    const p = book.products.find((x) => (x.sku && x.sku === code) || x.name.toLowerCase() === code.toLowerCase());
    if (p) setItems([...real, { product_id: p.id, name: p.name, qty: 1, price: p.price }]);
  };
  return (
    <form className="form" data-testid="invoice-form" onSubmit={async (e) => {
      e.preventDefault();
      try { const inv = await (isQuote ? createQuote(ctx, { ...f, items }) : createInvoice(ctx, { ...f, items })); closeSheet(); nav(`/invoices/${inv.id}`); } catch (err) { fail(err); }
    }}>
      {isQuote && <div className="small muted">{t('quote.help')}</div>}
      <Field label={t('inv.customer')}><input name="customer" list="dl-contacts" required autoFocus autoComplete="off" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
      <datalist id="dl-contacts">{book.contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <Field label={t('inv.customerPhone')}><input type="tel" value={f.phone} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <ScanToggle onCode={addScanned} />
      <ItemsEditor items={items} onChange={setItems} products={book.products} subtotal={!!(totals.discount || totals.tax)} />
      <Field label={t('tax.discount')}><MoneyInput value={f.discount} onChange={(discount) => setF({ ...f, discount })} name="discount" /></Field>
      <TotalsBlock totals={totals} book={book} />
      <div className="grid2">
        <Field label={t('common.date')}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t(isQuote ? 'quote.validUntil' : 'common.dueDate')}><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      </div>
      <Field label={t('inv.notes')}><input value={f.notes} placeholder={t('inv.notesPh')} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {isQuote ? <button className="btn primary block">{t('quote.create')}</button> : <>
      <Field label={t('inv.status')}>
        <select value={f.paid ? 'paid' : 'unpaid'} onChange={(e) => setF({ ...f, paid: e.target.value === 'paid' })}>
          <option value="unpaid">{t('inv.unpaidHelp')}</option><option value="paid">{t('inv.paidHelp')}</option>
        </select>
      </Field>
      {f.paid && <Field label={t('cash.paidWith')}><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as Method })}>{METHODS.filter((m) => m !== 'credit').map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select></Field>}
      <button className="btn primary block">{t('inv.create')}</button>
      </>}
    </form>
  );
}
