// Restock order in one tap (domain/restock.ts): build the order from what is running low, send it to the supplier on
// WhatsApp, and record the purchase in one tap when the goods arrive.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp, useBook } from '@/state/app';
import { useOverlay } from './overlay';
import { Icon } from './Icon';
import { Field, Seg } from './widgets';
import { formatMoney, toMajor, parseMoney } from '@/lib/money';
import { waLink } from '@/lib/phone';
import { dropOrder, orderTotal, pendingOrders, receiveOrder, reorderList, saveOrder, suppliersFor, type Order, type OrderLine } from '@/domain/restock';

/** Stock screen: the button that starts an order, and the orders waiting for goods. */
export function RestockCard() {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { openSheet } = useOverlay();
  const [orders, setOrders] = useState<Order[]>([]);
  const low = reorderList(book);
  const reload = () => { pendingOrders(ctx.orgId).then(setOrders).catch(() => {}); };
  useEffect(reload, [ctx.orgId, book]);
  if (!low.length && !orders.length) return null;
  return (
    <section className="card stack" data-testid="restock-card">
      {low.length > 0 && (
        <button type="button" className="btn get block" data-testid="restock-order" onClick={() => openSheet(t('restock.title'), <OrderSheet onDone={reload} />)}>
          <Icon name="send" size={18} /> {t('restock.button', { n: low.length })}
        </button>
      )}
      {orders.map((o) => (
        <div key={o.id} className="item" data-testid="restock-pending">
          <div className="main"><div className="t">{t('restock.waiting', { supplier: o.supplier })}</div>
            <div className="s">{o.date} · {o.lines.length} · {formatMoney(orderTotal(o.lines))}</div></div>
          <button type="button" className="btn sm primary" data-testid="restock-arrived" onClick={() => openSheet(t('restock.arrived'), <ArrivedSheet order={o} onDone={reload} />)}>{t('restock.arrived')}</button>
        </div>
      ))}
    </section>
  );
}

const Lines = ({ lines, setLines }: { lines: OrderLine[]; setLines: (l: OrderLine[]) => void }) => {
  const { t } = useTranslation();
  return (
    <div className="list">
      {lines.map((l, i) => (
        <div key={l.productId} className="item" data-testid="restock-line" data-product={l.name}>
          <div className="main"><div className="t">{l.name}</div><div className="s">{t('restock.each', { price: formatMoney(l.unitCost) })}</div></div>
          <input className="input" style={{ width: 70 }} type="number" inputMode="decimal" min={0} aria-label={t('restock.qtyOf', { name: l.name })} value={l.qty}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x)))} />
          <input className="input" style={{ width: 84 }} inputMode="decimal" aria-label={t('restock.priceOf', { name: l.name })} defaultValue={l.unitCost ? String(toMajor(l.unitCost)) : ''}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: parseMoney(e.target.value) } : x)))} />
        </div>
      ))}
    </div>
  );
};

function OrderSheet({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const book = useBook();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const list = reorderList(book);
  const suppliers = suppliersFor(book, list);
  const [lines, setLines] = useState<OrderLine[]>(list.map(({ supplier: _s, ...l }) => l));
  const [who, setWho] = useState(suppliers[0]?.name ?? list.find((l) => l.supplier)?.supplier ?? '');
  const [phone, setPhone] = useState(suppliers[0]?.phone ?? '');
  const kept = lines.filter((l) => l.qty > 0);
  const text = [t('restock.msgHead', { supplier: who.split(' ')[0] || '', shop: book.org.name }),
    ...kept.map((l) => `• ${l.qty} ${l.unit} ${l.name}`), t('restock.msgEnd')].join('\n');
  return (
    <form className="form" data-testid="restock-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!kept.length || !who.trim()) return;
      try {
        await saveOrder(ctx.orgId, { supplier: who.trim(), phone, lines: kept });
        window.open(waLink(phone, text, book.org.country_code), '_blank', 'noopener');
        closeSheet(); onDone(); toast(t('restock.sent', { supplier: who.trim() }));
      } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('restock.help')}</div>
      <Field label={t('restock.supplier')}>
        <input name="supplier" required list="restock-suppliers" value={who} autoComplete="off" onChange={(e) => {
          const c = suppliers.find((s) => s.name.toLowerCase() === e.target.value.trim().toLowerCase());
          setWho(e.target.value); if (c) setPhone(c.phone);
        }} />
        <datalist id="restock-suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
      </Field>
      <Field label={t('restock.phone')}><input name="phone" type="tel" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Lines lines={lines} setLines={setLines} />
      <div className="row between"><b>{t('restock.total')}</b><b className="num">{formatMoney(orderTotal(kept))}</b></div>
      <button className="btn get block" disabled={!kept.length}><Icon name="chat" size={18} /> {t('restock.send')}</button>
    </form>
  );
}

function ArrivedSheet({ order, onDone }: { order: Order; onDone: () => void }) {
  const { t } = useTranslation();
  const { ctx } = useApp();
  const { closeSheet, toast, fail } = useOverlay();
  const [lines, setLines] = useState(order.lines);
  const [method, setMethod] = useState<'cash' | 'credit'>('cash');
  return (
    <form className="form" data-testid="arrived-form" onSubmit={async (e) => {
      e.preventDefault();
      try { await receiveOrder(ctx, order, lines, method); closeSheet(); onDone(); toast(t('restock.recorded')); } catch (err) { fail(err); }
    }}>
      <div className="small muted">{t('restock.arrivedHelp', { supplier: order.supplier })}</div>
      <Lines lines={lines} setLines={setLines} />
      <div className="row between"><b>{t('restock.total')}</b><b className="num">{formatMoney(orderTotal(lines))}</b></div>
      <Field label={t('restock.paid')}><Seg value={method} onChange={setMethod} options={[['cash', t('restock.paidNow')], ['credit', t('restock.onCredit')]]} /></Field>
      <button className="btn primary block">{t('restock.record')}</button>
      <button type="button" className="btn ghost block" onClick={async () => { await dropOrder(ctx.orgId, order.id); closeSheet(); onDone(); }}>{t('restock.drop')}</button>
    </form>
  );
}
