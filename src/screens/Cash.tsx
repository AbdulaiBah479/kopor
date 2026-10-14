import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from '@/ui/overlay';
import { Page } from '@/ui/Shell';
import { Icon } from '@/ui/Icon';
import { Empty, Field, ItemsEditor, Money, MoneyInput, Seg, useDate } from '@/ui/widgets';
import { ScanToggle, TotalsBlock, ActionButton } from '@/ui/extras';
import { formatMoney } from '@/lib/money';
import { today, addDays, monthStart } from '@/lib/dates';
import type { LineItem, Method, Txn } from '@/db/schema';
import { recordSale, recordExpense, deleteTxn, summary, topProducts, itemsLabel, itemsTotal, EXPENSE_CATEGORIES, METHODS } from '@/domain/cash';
import { computeTotals, taxSettings } from '@/domain/tax';
import { recordReturn, returnedQty } from '@/domain/returns';
import { expectedCash, closeDay, lastClosing } from '@/domain/closing';
import { DeleteButton } from './Credit';

type Range = 'today' | 'week' | 'month' | 'all';
const rangeDates = (r: Range): [string, string] => {
  const now = today();
  return r === 'today' ? [now, now] : r === 'week' ? [addDays(now, -6), now] : r === 'month' ? [monthStart(now), now] : ['0000-00-00', '9999-12-31'];
};

export function CashBook() {
  const { t } = useTranslation();
  const book = useBook();
  const { can } = useApp();
  const { openSheet } = useOverlay();
  const { fmt } = useDate();
  const [range, setRange] = useState<Range>('week');
  const [from, to] = rangeDates(range);
  const s = summary(book, from, to);
  const top = topProducts(book, from, to, 3);
  const entries = book.txns.filter((x) => x.date >= from && x.date <= to).sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at);
  const days = new Map<string, Txn[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  const contactName = (id: string | null) => book.contacts.find((c) => c.id === id)?.name;
  const methodTotal = Object.values(s.byMethod).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const rel = (d: string) => (d === today() ? t('common.today') : d === addDays(today(), -1) ? t('common.yesterday') : fmt(d));
  const last = lastClosing(book);
  const label = (e: Txn) => e.type === 'in' ? itemsLabel(e.items) || e.note || t('categories.sale') : e.category === 'refund' ? `${t('returns.refund')}: ${itemsLabel(e.items)}` : t(`categories.${e.category}`);

  return (
    <Page title={t('cash.title')} sub={t('cash.sub')}
      after={can('record') && (
        <div className="sticky-actions"><div className="btn-row">
          <button className="btn get" data-testid="new-sale" onClick={() => openSheet(t('cash.newSale'), <SaleSheet />)}><Icon name="plus" size={18} /> {t('home.sale')}</button>
          <button className="btn give" data-testid="new-expense" onClick={() => openSheet(t('cash.newExpense'), <ExpenseSheet />)}><Icon name="minus" size={18} /> {t('home.expense')}</button>
        </div></div>
      )}>
      <Seg value={range} onChange={setRange} options={[['today', t('common.today')], ['week', t('cash.range7')], ['month', t('cash.rangeMonth')], ['all', t('common.all')]]} />
      <div className="grid3">
        <div className="stat"><div className="k">{t('cash.sales')}</div><div className="v"><Money v={s.sales} className="good" /></div></div>
        <div className="stat"><div className="k">{t('cash.expenses')}</div><div className="v"><Money v={s.expenses} className="bad" /></div></div>
        <div className="stat"><div className="k">{t('cash.profit')}</div><div className="v"><Money v={s.profit} /></div></div>
      </div>
      {(s.tax > 0 || s.refunds > 0 || s.discounts > 0) && (
        <div className="card flat small row between" style={{ flexWrap: 'wrap' }}>
          {s.tax > 0 && <span>{t('tax.collected')}: <b className="num">{formatMoney(s.tax)}</b></span>}
          {s.discounts > 0 && <span>{t('tax.discounts')}: <b className="num">{formatMoney(s.discounts)}</b></span>}
          {s.refunds > 0 && <span>{t('returns.refunds')}: <b className="num">{formatMoney(s.refunds)}</b></span>}
        </div>
      )}
      {can('close') && (
        <button className="card row" style={{ border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit' }} data-testid="close-day"
          onClick={() => openSheet(t('closing.title'), <CloseDaySheet />)}>
          <div className="avatar" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="lock" size={18} /></div>
          <div className="spacer"><b>{t('closing.title')}</b>
            <div className="small muted">{last ? t('closing.last', { date: fmt(last.date), diff: formatMoney(last.difference, { sign: true }) }) : t('closing.help')}</div></div>
          <Icon name="chev" />
        </button>
      )}
      {methodTotal > 0 && (
        <div className="card method-bars">
          <h3>{t('cash.byMethod')}</h3>
          {Object.entries(s.byMethod).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
            <div className="row" key={m}><span>{t(`methods.${m}`)}</span><div className="meter"><i style={{ width: `${(v / methodTotal) * 100}%` }} /></div><b className="num small">{formatMoney(v)}</b></div>
          ))}
        </div>
      )}
      {top.length > 0 && <div className="card flat small"><b>{t('cash.bestSellers')}:</b> {top.map((p) => `${p.name} (${formatMoney(p.amount)})`).join(' · ')}</div>}
      <div className="list">
        {entries.length ? [...days].map(([date, rows]) => (
          <div key={date}>
            <div className="day-head"><span>{rel(date)}</span><span className="num">{formatMoney(rows.reduce((a, e) => a + (e.type === 'in' ? e.amount : -e.amount), 0), { sign: true })}</span></div>
            {rows.map((e) => (
              <button key={e.id} type="button" className="item" style={{ width: '100%', border: 0, textAlign: 'left', font: 'inherit' }} onClick={() => openSheet(label(e), <TxnSheet txn={e} />)}>
                <div className="avatar" style={{ background: e.type === 'in' ? 'var(--good-soft)' : 'var(--warn-soft)', color: e.type === 'in' ? 'var(--good)' : 'var(--warn)' }}><Icon name={e.type === 'in' ? 'plus' : e.category === 'refund' ? 'back' : 'minus'} size={18} /></div>
                <div className="main">
                  <div className="t">{label(e)}</div>
                  <div className="s">{t(`methods.${e.method}`)}{e.contact_id && ` · ${contactName(e.contact_id) ?? ''}`}{e.type === 'out' && e.category !== 'refund' && e.note && ` · ${e.note}`}</div>
                </div>
                <div className={`amt num ${e.type === 'in' ? 'good' : 'bad'}`}>{e.type === 'in' ? '+' : '-'}{formatMoney(e.amount)}</div>
              </button>
            ))}
          </div>
        )) : <Empty icon="cash" title={t('cash.nothing')} text={t('cash.nothingHelp')} />}
      </div>
      <div style={{ height: 56 }} />
    </Page>
  );
}

export function SaleSheet({ prefill = {} }: { prefill?: { items?: Partial<LineItem>[]; amount?: number; method?: Method; customer?: string; note?: string } }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [items, setItems] = useState<Partial<LineItem>[]>(prefill.items ?? []);
  const [amount, setAmount] = useState(prefill.amount ?? 0);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<Method>(prefill.method ?? 'cash');
  const [customer, setCustomer] = useState(prefill.customer ?? '');
  const [note, setNote] = useState(prefill.note ?? '');
  const [date, setDate] = useState(today());
  const real = items.filter((i) => i.name?.trim());
  const hasItems = real.length > 0;
  const tax = taxSettings(book.org);
  const totals = hasItems
    ? computeTotals(itemsTotal(real.map((i) => ({ product_id: null, name: '', cost: 0, qty: i.qty ?? 0, price: i.price ?? 0 }))), discount, tax)
    : computeTotals(amount, discount, { ...tax, inclusive: true });

  const addScanned = (code: string) => {
    const p = book.products.find((x) => (x.sku && x.sku === code) || x.name.toLowerCase() === code.toLowerCase());
    if (!p) { toast(t('scan.notFound', { code })); return; }
    const idx = items.findIndex((i) => i.product_id === p.id);
    if (idx >= 0) setItems(items.map((i, k) => (k === idx ? { ...i, qty: (i.qty ?? 0) + 1 } : i)));
    else setItems([...items.filter((i) => i.name?.trim()), { product_id: p.id, name: p.name, qty: 1, price: p.price }]);
  };

  return (
    <form className="form" data-testid="sale-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const txn = await recordSale(ctx, { items, amount, discount, method, customer, note, date });
        closeSheet(); toast(t(method === 'credit' ? 'cash.creditSaved' : 'cash.saleSaved'), { undo: () => deleteTxn(ctx, txn.id) });
      } catch (err) { fail(err); }
    }}>
      <ScanToggle onCode={addScanned} />
      <ItemsEditor items={items} onChange={setItems} products={book.products} subtotal={!!(totals.discount || totals.tax)} />
      {!hasItems && <Field label={t('cash.amountAuto')}><MoneyInput big value={amount} onChange={setAmount} name="amount" /></Field>}
      <Field label={t('tax.discount')}><MoneyInput value={discount} onChange={setDiscount} name="discount" /></Field>
      <TotalsBlock totals={totals} book={book} />
      <Field label={t('cash.method')}>
        <select name="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select>
      </Field>
      <Field label={t('cash.customer')}><input name="customer" list="dl-contacts" autoComplete="off" value={customer} placeholder={t('common.optional')} onChange={(e) => setCustomer(e.target.value)} required={method === 'credit'} /></Field>
      <datalist id="dl-contacts">{book.contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <div className="grid2">
        <Field label={t('common.date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('common.note')}><input value={note} placeholder={t('common.optional')} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <button className="btn get block"><Icon name="check" size={18} /> {t('cash.saveSale')}{totals.total > 0 ? ` · ${formatMoney(totals.total)}` : ''}</button>
    </form>
  );
}

export function ExpenseSheet({ prefill = {} }: { prefill?: { amount?: number; category?: string; note?: string } }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [f, setF] = useState({ amount: prefill.amount ?? 0, category: prefill.category ?? 'other', method: 'cash' as Method, note: prefill.note ?? '', date: today() });
  return (
    <form className="form" data-testid="expense-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const txn = await recordExpense(ctx, f);
        closeSheet(); toast(t('cash.expenseSaved'), { undo: () => deleteTxn(ctx, txn.id) });
      } catch (err) { fail(err); }
    }}>
      <Field label={t('common.amount')}><MoneyInput big autoFocus required value={f.amount} onChange={(amount) => setF({ ...f, amount })} name="amount" /></Field>
      <Field label={t('cash.category')}>
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}</select>
      </Field>
      <Field label={t('cash.paidWith')}>
        <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as Method })}>{METHODS.filter((m) => m !== 'credit').map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select>
      </Field>
      <div className="grid2">
        <Field label={t('common.date')}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t('common.note')}><input value={f.note} placeholder={t('common.optional')} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <button className="btn give block"><Icon name="check" size={18} /> {t('cash.saveExpense')}</button>
    </form>
  );
}

function TxnSheet({ txn }: { txn: Txn }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx, can } = useApp();
  const { toast, fail, openSheet } = useOverlay();
  const { fmt } = useDate();
  const printReceipt = async () => {
    try {
      const p = await import('@/features/printer');
      const settings = await p.getPrinter();
      await p.printBytes(p.receiptBytes(book, { txn }, t, settings.width));
      toast(t('printer.sent'));
    } catch (e) { fail(e); }
  };
  return (
    <div className="stack">
      <div className="card flat">
        <div className="row between"><b className="num" style={{ fontSize: 22 }}>{formatMoney(txn.amount)}</b><span className="badge">{t(`methods.${txn.method}`)}</span></div>
        <div className="muted small">{fmt(txn.date)} · {txn.category === 'refund' ? t('returns.refund') : t(`categories.${txn.category}`)}{txn.note && ` · ${txn.note}`}</div>
        {txn.items.length > 0 && (
          <table style={{ width: '100%', marginTop: 8, fontSize: 14 }}><tbody>
            {txn.items.map((i, k) => <tr key={k}><td>{i.name}</td><td className="num" style={{ textAlign: 'right' }}>{i.qty}</td><td className="num" style={{ textAlign: 'right' }}>{formatMoney(i.qty * i.price)}</td></tr>)}
          </tbody></table>
        )}
        {(txn.discount || txn.tax) ? <div className="small muted" style={{ marginTop: 6 }}>{txn.discount ? `${t('tax.discount')} ${formatMoney(txn.discount)} · ` : ''}{txn.tax ? `${t('tax.tax')} ${formatMoney(txn.tax)}` : ''}</div> : null}
      </div>
      {txn.type === 'in' && <ActionButton icon="print" label={t('printer.print')} run={printReceipt} className="btn block" />}
      {txn.type === 'in' && txn.items.length > 0 && can('returns') && (
        <button className="btn block" onClick={() => openSheet(t('returns.title'), <ReturnSheet txn={txn} />)}><Icon name="back" size={18} /> {t('returns.title')}</button>
      )}
      {can('edit') && <><div className="small muted">{t('cash.deleteHelp')}</div><DeleteButton onDelete={async () => { await deleteTxn(ctx, txn.id); toast(t('common.deleted')); }} /></>}
    </div>
  );
}

function ReturnSheet({ txn }: { txn: Txn }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [done, setDone] = useState<number[]>([]);
  const [qty, setQty] = useState<number[]>(txn.items.map(() => 0));
  const [method, setMethod] = useState<Method>(txn.method === 'credit' ? 'credit' : txn.method);
  useEffect(() => { returnedQty(txn.id).then(setDone); }, [txn.id]);
  return (
    <form className="form" data-testid="return-form" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await recordReturn(ctx, txn.id, qty.map((q, index) => ({ index, qty: q })), { method });
        closeSheet(); toast(t('returns.saved'));
      } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('returns.help')}</div>
      {txn.items.map((it, k) => {
        const left = it.qty - (done[k] ?? 0);
        return (
          <div key={k} className="row between">
            <span>{it.name} <small className="muted">({t('returns.left', { n: left })})</small></span>
            <input name="return_qty" inputMode="decimal" style={{ width: 80 }} className="input" value={qty[k] || ''} placeholder="0" disabled={left <= 0}
              onChange={(e) => setQty(qty.map((q, i) => (i === k ? Math.min(left, Number(e.target.value) || 0) : q)))} />
          </div>
        );
      })}
      {txn.method !== 'credit' && (
        <Field label={t('returns.refundWith')}>
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.filter((m) => m !== 'credit').map((m) => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</select>
        </Field>
      )}
      {txn.method === 'credit' && <div className="small muted">{t('returns.creditNote')}</div>}
      <button className="btn give block">{t('returns.confirm')}</button>
    </form>
  );
}

function CloseDaySheet() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [float, setFloat] = useState(0);
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const x = expectedCash(book, today(), float);
  const diff = counted - x.expected;
  return (
    <form className="form" data-testid="close-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await closeDay(ctx, { openingFloat: float, counted, expected: x.expected, note }); closeSheet(); toast(t('closing.saved')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('closing.help')}</div>
      <Field label={t('closing.float')}><MoneyInput value={float} onChange={setFloat} name="float" /></Field>
      <div className="card flat stack small">
        <div className="row between"><span>{t('closing.cashSales')}</span><span className="num">+{formatMoney(x.sales)}</span></div>
        <div className="row between"><span>{t('closing.cashOut')}</span><span className="num">-{formatMoney(x.out)}</span></div>
        <div className="row between"><b>{t('closing.expected')}</b><b className="num">{formatMoney(x.expected)}</b></div>
        {x.repaid > 0 && <div className="muted">{t('closing.repaidNote', { amount: formatMoney(x.repaid) })}</div>}
      </div>
      <Field label={t('closing.counted')}><MoneyInput big required value={counted} onChange={setCounted} name="counted" /></Field>
      {counted > 0 && (
        <div className={`alert ${diff < 0 ? 'bad' : ''}`} style={diff === 0 ? { background: 'var(--good-soft)' } : undefined}>
          <Icon name={diff === 0 ? 'check' : 'alert'} />
          <div>{diff === 0 ? t('closing.balanced') : diff > 0 ? t('closing.over', { amount: formatMoney(diff) }) : t('closing.short', { amount: formatMoney(-diff) })}</div>
        </div>
      )}
      <Field label={t('common.note')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional')} /></Field>
      <button className="btn primary block">{t('closing.save')}</button>
    </form>
  );
}
