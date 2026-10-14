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
import type { Invoice, LineItem, Method } from '@/db/schema';
import { itemsTotal, METHODS } from '@/domain/cash';
import { createInvoice, markInvoicePaid, voidInvoice, invoiceCode, invoiceTotal } from '@/domain/invoices';
import { computeTotals, taxSettings } from '@/domain/tax';
import { ActionButton, ScanToggle, TotalsBlock } from '@/ui/extras';
import { MoneyInput } from '@/ui/widgets';
import { shareFile } from '@/lib/share';
import { createCheckout, createUssdCode } from '@/cloud/payments';

const isOverdue = (i: Invoice) => i.status === 'unpaid' && !!i.due_date && i.due_date < today();

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
    <Page title={t('inv.title')} sub={t('inv.sub', { count: unpaid.length, amount: formatMoney(unpaid.reduce((s, i) => s + invoiceTotal(i), 0)) })} back="/more"
      fab={can('record') && <button className="fab" onClick={() => openSheet(t('inv.new'), <NewInvoiceSheet />)}><Icon name="plus" /> {t('inv.new')}</button>}>
      {book.invoices.length > 4 && <Search value={q} onChange={setQ} placeholder={t('common.search')} />}
      <div className="list">
        {list.length ? list.map((inv) => (
          <Link key={inv.id} className="item" to={`/invoices/${inv.id}`}>
            <div className="avatar"><Icon name="file" size={18} /></div>
            <div className="main">
              <div className="t">{inv.customer} <span className={`badge ${inv.status === 'paid' ? 'good' : isOverdue(inv) ? 'bad' : inv.status === 'void' ? '' : 'warn'}`}>{t(inv.status === 'paid' ? 'inv.paid' : inv.status === 'void' ? 'inv.void' : isOverdue(inv) ? 'inv.overdue' : 'inv.unpaid')}</span></div>
              <div className="s">{inv.number} Â· {fmt(inv.date)}</div>
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
  const publicUrl = `${location.origin}${location.pathname}#/i/${inv.public_token}`;
  const share = t('inv.shareMsg', {
    kind: t(paid ? 'inv.receipt' : 'inv.invoice'), number: inv.number, business: org.name, date: fmt(inv.date),
    lines: inv.items.map((i) => `â€¢ ${i.qty} Ã— ${i.name}: ${formatMoney(i.qty * i.price)}`).join('\n'), total: formatMoney(total),
    extra: paid ? '\nâœ… ' + t('inv.paid') : `${inv.due_date ? `\n${t('inv.due')}: ${fmt(inv.due_date)}` : ''}${org.momo_number ? `\n${t('inv.payMomo')}: ${org.momo_number}` : ''}`, code,
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
    <Page title={inv.number} sub={t(paid ? 'inv.paid' : inv.status === 'void' ? 'inv.void' : 'inv.unpaid')} back="/invoices">
      <div className="doc">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><h2>{org.name}</h2><div className="small">{org.address}{org.phone && <><br />{org.phone}</>}</div></div>
          <div style={{ textAlign: 'right' }}>
            <b style={{ fontSize: 18 }}>{t(paid ? 'inv.receipt' : 'inv.invoice')}</b><div className="small">{inv.number}</div>
            <div className="stamp" style={{ color: paid ? '#0b7a3b' : '#a8650a', marginTop: 6 }}>{t(paid ? 'inv.paid' : inv.status === 'void' ? 'inv.void' : 'inv.due').toUpperCase()}</div>
          </div>
        </div>
        <div className="meta" style={{ marginTop: 16 }}>
          <div><div className="small">{t('inv.billTo')}</div><b>{inv.customer}</b>{inv.phone && <><br />{inv.phone}</>}</div>
          <div style={{ textAlign: 'right' }} className="small">
            <div>{t('common.date')}: {fmt(inv.date)}</div>
            {!paid && inv.due_date && <div>{t('inv.due')}: {fmt(inv.due_date)}</div>}
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
        {!paid && org.momo_number && <div className="small" style={{ marginTop: 8 }}><b>{t('inv.payMomo')}:</b> {org.momo_number}</div>}
        <div className="foot">{t('inv.verify')}: <b>{code}</b> Â· {t('inv.generated')}</div>
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

function NewInvoiceSheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, fail } = useOverlay();
  const nav = useNavigate();
  const [items, setItems] = useState<Partial<LineItem>[]>([]);
  const [f, setF] = useState({ customer: '', phone: '', date: today(), dueDate: addDays(today(), 7), notes: '', paid: false, method: 'cash' as Method, discount: 0 });
  const real = items.filter((i) => i.name?.trim());
  const totals = computeTotals(itemsTotal(real.map((i) => ({ product_id: null, name: '', cost: 0, qty: i.qty ?? 0, price: i.price ?? 0 }))), f.discount, taxSettings(book.org));
  const addScanned = (code: string) => {
    const p = book.products.find((x) => (x.sku && x.sku === code) || x.name.toLowerCase() === code.toLowerCase());
    if (p) setItems([...real, { product_id: p.id, name: p.name, qty: 1, price: p.price }]);
  };
  return (
    <form className="form" data-testid="invoice-form" onSubmit={async (e) => {
      e.preventDefault();
      try { const inv = await createInvoice(ctx, { ...f, items }); closeSheet(); nav(`/invoices/${inv.id}`); } catch (err) { fail(err); }
    }}>
      <Field label={t('inv.customer')}><input name="customer" list="dl-contacts" required autoFocus autoComplete="off" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
      <datalist id="dl-contacts">{book.contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <Field label={t('inv.customerPhone')}><input type="tel" value={f.phone} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <ScanToggle onCode={addScanned} />
      <ItemsEditor items={items} onChange={setItems} products={book.products} subtotal={!!(totals.discount || totals.tax)} />
      <Field label={t('tax.discount')}><MoneyInput value={f.discount} onChange={(discount) => setF({ ...f, discount })} name="discount" /></Field>
      <TotalsBlock totals={totals} book={book} />
      <div className="grid2">
        <Field label={t('common.date')}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t('common.dueDate')}><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      </div>
      <Field label={t('inv.notes')}><input value={f.notes} placeholder={t('inv.notesPh')} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <Field label={t('inv.status')}>
        <select value={f.paid ? 'paid' : 'unpaid'} onChange={(e) => setF({ ...f, paid: e.target.value === 'paid' })}>
          <option value="unpaid">{t('inv.unpaidHelp')}</option><option value="paid">{t('inv.paidHelp')}</option>
        </select>
      </Field>
      {f.paid && <Field label={t('cash.paidWith')}><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as Method })}>{METHODS.filter((m) => m !== 'credit').map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select></Field>}
      <button className="btn primary block">{t('inv.create')}</button>
    </form>
  );
}
